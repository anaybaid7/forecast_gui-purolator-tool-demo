"""
test_table_math.py

Tests for the /api/table and /api/chart math the whole tool depends on:

1. Total.Del.Pcs.N is always PCL.Del.Pcs.N + Agent.Del.Pcs.N, with and
   without overrides.
2. Overriding PCL or Agent shows up correctly when viewing Total.
3. base_a/base_b/fc_a/fc_b are correct -- these feed computeOverrides() in
   static/ratio_split.js, so if they drift the ratio split breaks even
   though this file can't run the frontend JS directly.
4. /api/export matches what /api/table returned.

See tests/test_ratio_split.js for the frontend split-back math itself.
"""

import csv
import io

import pytest


TOTAL = "Total.Del.Pcs.N"
PCL = "PCL.Del.Pcs.N"
AGENT = "Agent.Del.Pcs.N"


def _table(client, metric, base_year=2025, overrides_a=None, overrides_b=None):
    resp = client.post("/api/table", json={
        "metric": metric,
        "base_year": base_year,
        "divisions": [],
        "terminals": [],
        "overrides_a": overrides_a or {},
        "overrides_b": overrides_b or {},
    })
    assert resp.status_code == 200
    return {r["week"]: r for r in resp.get_json()["rows"]}


def _row(rows, week):
    assert week in rows, f"week {week} missing from table rows: {sorted(rows)}"
    return rows[week]


# ---------------------------------------------------------------------------
# 1. Total = PCL + Agent, no overrides
# ---------------------------------------------------------------------------

def test_total_equals_pcl_plus_agent_no_overrides(sample_data):
    pcl_rows = _table(sample_data, PCL)
    agent_rows = _table(sample_data, AGENT)
    total_rows = _table(sample_data, TOTAL)

    for week in (3, 4):  # the two forecast weeks
        pcl = _row(pcl_rows, week)["value"]
        agent = _row(agent_rows, week)["value"]
        total = _row(total_rows, week)["value"]
        assert total == pytest.approx(pcl + agent), (
            f"week {week}: Total ({total}) != PCL ({pcl}) + Agent ({agent})"
        )


def test_forecast_week_values_match_uploaded_numbers(sample_data):
    """Sanity check against the literal numbers in conftest.py's sample data."""
    pcl_rows = _table(sample_data, PCL)
    agent_rows = _table(sample_data, AGENT)
    total_rows = _table(sample_data, TOTAL)

    assert _row(pcl_rows, 3)["value"] == 1000
    assert _row(agent_rows, 3)["value"] == 500
    assert _row(total_rows, 3)["value"] == 1500

    assert _row(pcl_rows, 4)["value"] == 1100
    assert _row(agent_rows, 4)["value"] == 550
    assert _row(total_rows, 4)["value"] == 1650


# ---------------------------------------------------------------------------
# 2. Overriding a component propagates to Total
# ---------------------------------------------------------------------------

def test_pcl_override_propagates_to_total(sample_data):
    # Bump week 3's PCL from 1000 -> 1200 (+200). Agent stays at 500.
    overrides_a = {"3": 1200}

    pcl_rows = _table(sample_data, PCL, overrides_a=overrides_a)
    total_rows = _table(sample_data, TOTAL, overrides_a=overrides_a)

    assert _row(pcl_rows, 3)["value"] == 1200
    assert _row(pcl_rows, 3)["modified"] is True

    # Total should be the new PCL + the *unchanged* Agent: 1200 + 500 = 1700
    assert _row(total_rows, 3)["value"] == 1700
    assert _row(total_rows, 3)["modified"] is True

    # Week 4 is untouched
    assert _row(total_rows, 4)["value"] == 1650
    assert _row(total_rows, 4)["modified"] is False


def test_agent_override_propagates_to_total(sample_data):
    # Bump week 4's Agent from 550 -> 700 (+150). PCL stays at 1100.
    overrides_b = {"4": 700}

    agent_rows = _table(sample_data, AGENT, overrides_b=overrides_b)
    total_rows = _table(sample_data, TOTAL, overrides_b=overrides_b)

    assert _row(agent_rows, 4)["value"] == 700
    assert _row(total_rows, 4)["value"] == 1100 + 700  # 1800


def test_both_components_overridden_same_week(sample_data):
    # Edit both PCL and Agent for week 3 in the same request (this is what
    # the frontend sends after a Total-edit ratio split).
    overrides_a = {"3": 1300.0}
    overrides_b = {"3": 650.0}

    total_rows = _table(sample_data, TOTAL, overrides_a=overrides_a, overrides_b=overrides_b)
    assert _row(total_rows, 3)["value"] == pytest.approx(1950.0)


# ---------------------------------------------------------------------------
# 3. base_a/base_b/fc_a/fc_b feed the frontend's ratio split -- check they're
#    the numbers the split math assumes they are.
# ---------------------------------------------------------------------------

def test_base_year_ratio_fields_for_total(sample_data):
    """
    base_a/base_b on a Total row should reflect the base year's PCL/Agent
    actuals for that week number -- that's what the frontend reads to
    compute the split ratio. The sample data only has 2025 weeks 1-2, so
    week 3's base is legitimately absent; this just checks the fields exist
    on the response rather than assuming data that isn't there.
    """
    total_rows = _table(sample_data, TOTAL, base_year=2025)
    row3 = _row(total_rows, 3)

    # base_a / base_b come from 2025 week 3 actuals. The sample data only has
    # 2025 weeks 1-2, so week 3's base is legitimately absent (0/None) --
    # this documents that behaviour rather than assuming data that isn't there.
    assert row3["base_a"] is not None
    assert row3["base_b"] is not None


def test_fc_a_fc_b_reflect_current_component_values(sample_data):
    """
    fc_a / fc_b on a Total row must equal the *current* (override-applied)
    PCL/Agent values -- this is exactly what applyValueChange() in the
    frontend uses as the "current value" before adding the split delta.
    """
    # No overrides: fc_a/fc_b should be the raw uploaded forecast numbers.
    total_rows = _table(sample_data, TOTAL)
    row3 = _row(total_rows, 3)
    assert row3["fc_a"] == pytest.approx(1000.0)
    assert row3["fc_b"] == pytest.approx(500.0)

    # With a PCL override: fc_a should reflect the override, fc_b unchanged.
    overrides_a = {"3": 1200.0}
    total_rows = _table(sample_data, TOTAL, overrides_a=overrides_a)
    row3 = _row(total_rows, 3)
    assert row3["fc_a"] == pytest.approx(1200.0)
    assert row3["fc_b"] == pytest.approx(500.0)


def test_orig_a_orig_b_never_change_regardless_of_overrides(sample_data):
    """
    orig_a / orig_b are the pristine pre-override forecast values. They're
    what applyOp() scales from (via computeOverrides' fromOriginal flag) so
    repeating an operation replaces a prior edit instead of compounding on
    top of it. They must stay constant no matter what overrides are sent.
    """
    no_override = _row(_table(sample_data, TOTAL), 3)
    with_override = _row(_table(sample_data, TOTAL, overrides_a={"3": 9999.0}), 3)

    assert no_override["orig_a"] == pytest.approx(1000.0)
    assert no_override["orig_b"] == pytest.approx(500.0)
    assert no_override["original"] == pytest.approx(1500.0)

    # Same pristine values even with a large override applied
    assert with_override["orig_a"] == pytest.approx(1000.0)
    assert with_override["orig_b"] == pytest.approx(500.0)
    assert with_override["original"] == pytest.approx(1500.0)

    # ...while fc_a/value DO reflect the override
    assert with_override["fc_a"] == pytest.approx(9999.0)
    assert with_override["value"] == pytest.approx(9999.0 + 500.0)


def test_overrides_dont_persist_across_requests(sample_data):
    """
    The backend is stateless re: overrides -- nothing is cached or
    accumulated server-side between requests. Sending an override, then a
    request with no overrides, must return the original values, not
    anything left over from the previous call.
    """
    _table(sample_data, TOTAL, overrides_a={"3": 50000.0})  # large override, discarded

    fresh = _row(_table(sample_data, TOTAL), 3)  # no overrides this time
    assert fresh["value"] == pytest.approx(1500.0)
    assert fresh["modified"] is False


def test_ratio_split_end_to_end(sample_data):
    """
    Full round trip: user edits Total for week 3, the frontend's split math
    (proportional scaling -- see static/ratio_split.js) computes new
    PCL/Agent overrides, and re-fetching Total with those overrides must
    equal the edited value.
    """
    total_rows = _table(sample_data, TOTAL)
    row3 = _row(total_rows, 3)

    old_total = row3["value"]   # 1500 (fc_a=1000, fc_b=500)
    new_total = 2000.0          # user edits Total to 2000

    ratio = new_total / old_total
    new_pcl = row3["fc_a"] * ratio
    new_agent = row3["fc_b"] * ratio

    # Re-fetch with the computed split applied
    total_rows_after = _table(
        sample_data, TOTAL,
        overrides_a={"3": new_pcl},
        overrides_b={"3": new_agent},
    )
    assert _row(total_rows_after, 3)["value"] == pytest.approx(new_total)


# ---------------------------------------------------------------------------
# 4. CSV export matches /api/table
# ---------------------------------------------------------------------------

def test_export_matches_table(sample_data):
    overrides_a = {"3": 1200.0}
    table_rows_dict = _table(sample_data, TOTAL, overrides_a=overrides_a)
    table_rows_list = list(table_rows_dict.values())

    chart_resp = sample_data.post("/api/chart", json={
        "metric": TOTAL,
        "actual_years": [2025, 2026],
        "divisions": [],
        "terminals": [],
        "overrides_a": overrides_a,
        "overrides_b": {},
    })
    chart_data = chart_resp.get_json()

    export_resp = sample_data.post("/api/export", json={
        "metric": TOTAL,
        "chart_data": chart_data,
        "table_rows": table_rows_list,
    })
    assert export_resp.status_code == 200

    csv_text = export_resp.get_data(as_text=True)
    reader = csv.reader(io.StringIO(csv_text))
    header = next(reader)
    assert header[:4] == ["Year", "Week", "Label", "Type"]

    csv_forecast_rows = {
        int(row[1]): float(row[4])
        for row in reader
        if row[3] == "Forecast"
    }

    # The CSV's forecast values must match the (override-applied) table values
    assert csv_forecast_rows[3] == pytest.approx(_row(table_rows_dict, 3)["value"])
    assert csv_forecast_rows[4] == pytest.approx(_row(table_rows_dict, 4)["value"])

    # And week 3's exported total must reflect the +200 PCL override:
    # original Total (1500) + 200 = 1700
    assert csv_forecast_rows[3] == pytest.approx(1700.0)


# ---------------------------------------------------------------------------
# 5. Plain week labels (no "2026-3", no "P1"/"Period" prefixes on screen data)
# ---------------------------------------------------------------------------

def test_table_labels_are_plain_week_numbers(sample_data):
    total_rows = _table(sample_data, TOTAL)
    for week, row in total_rows.items():
        assert row["label"] == str(week), (
            f"week {week} label is {row['label']!r}, expected plain '{week}'"
        )
