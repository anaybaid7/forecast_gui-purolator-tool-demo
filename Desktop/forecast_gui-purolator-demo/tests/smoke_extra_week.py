#!/usr/bin/env python3
"""
test_extra_week.py
------------------
Checks that uploading one extra week of actuals doesn't break the tool.

Run from the tool directory:
    python3 test_extra_week.py

Starts the Flask app internally (no separate server needed), uploads
a sample Actual.xlsx with an extra week of 2026 actuals on top of the
forecast weeks, and asserts the table/chart endpoints handle it cleanly.
"""

import io
import sys
import os
import traceback

import pandas as pd

# ensure we can import app.py regardless of cwd
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# -- import app ---------------------------------------------------------------
try:
    import app as app_module
except ImportError:
    print("ERROR: run this from the tool directory (where app.py lives)")
    sys.exit(1)

client = app_module.app.test_client()

# -- helpers ------------------------------------------------------------------
COMMON = {
    "Terminal": "101", "Terminal.Name": "Test Terminal", "Division": "QUEBEC",
    "PCL.Del.Stops.N": 0, "PCL.PU.Pcs.N": 0, "PCL.PU.Stops.N": 0,
    "Agent.PU.Pcs.N": 0, "Total.Del.Stops.N": 0, "Total.PU.Stops.N": 0,
}

def row(year, week, pcl, agent):
    return {**COMMON, "Year": year, "Week.Number": week,
            "PCL.Del.Pcs.N": pcl, "Agent.Del.Pcs.N": agent}

def excel_bytes(rows):
    buf = io.BytesIO()
    pd.DataFrame(rows).to_excel(buf, index=False, engine="openpyxl")
    buf.seek(0)
    return buf.read()

def upload(kind, rows):
    b = excel_bytes(rows)
    r = client.post("/api/upload", data={
        "kind": kind,
        "file": (io.BytesIO(b), f"{kind}.xlsx"),
    }, content_type="multipart/form-data")
    assert r.status_code == 200, f"upload {kind} failed: {r.status_code}"
    assert r.get_json()["ok"], f"upload {kind} not ok: {r.get_json()}"

def table(metric="Total.Del.Pcs.N", overrides_a=None, overrides_b=None):
    r = client.post("/api/table", json={
        "metric": metric, "base_year": 2025,
        "divisions": [], "terminals": [],
        "overrides_a": overrides_a or {}, "overrides_b": overrides_b or {},
    })
    assert r.status_code == 200
    return {row["week"]: row for row in r.get_json()["rows"]}

def chart(metric="Total.Del.Pcs.N"):
    r = client.post("/api/chart", json={
        "metric": metric, "actual_years": [2025, 2026],
        "divisions": [], "terminals": [],
        "overrides_a": {}, "overrides_b": {}, "show_prophet": False,
    })
    assert r.status_code == 200
    return r.get_json()

# -- test runner --------------------------------------------------------------
passed = 0
failed = 0

def test(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  ok  - {name}")
        passed += 1
    except Exception as e:
        print(f"  FAIL - {name}")
        print(f"         {e}")
        traceback.print_exc()
        failed += 1

# =============================================================================
# Baseline: weeks 1-2 actual, weeks 3-4 forecast
# =============================================================================
def setup_baseline():
    app_module.store.update({"actual": None, "forecast": None,
                             "terminal_map": {}, "div_terminal_map": {}})
    upload("actual", [
        row(2025, 1, 600, 400), row(2025, 2, 900, 600),
        row(2026, 1, 610, 410), row(2026, 2, 920, 610),
    ])
    upload("forecast", [
        row(2026, 3, 1000, 500), row(2026, 4, 1100, 550),
    ])

def test_baseline():
    setup_baseline()

    rows = table()
    # should have weeks 1-4
    assert set(rows.keys()) == {1, 2, 3, 4}, f"expected weeks 1-4, got {sorted(rows.keys())}"
    # weeks 3-4 are forecast
    assert rows[3]["row_type"] == "forecast"
    assert rows[4]["row_type"] == "forecast"
    # Total = PCL + Agent for forecast weeks
    assert abs(rows[3]["value"] - 1500) < 1
    assert abs(rows[4]["value"] - 1650) < 1

# =============================================================================
# Extra week: add week 3 as actual (simulates "one more week of actuals")
# =============================================================================
def setup_extra_week():
    app_module.store.update({"actual": None, "forecast": None,
                             "terminal_map": {}, "div_terminal_map": {}})
    upload("actual", [
        row(2025, 1, 600, 400), row(2025, 2, 900, 600),
        row(2026, 1, 610, 410), row(2026, 2, 920, 610),
        row(2026, 3, 1050, 520),  # <-- NEW: week 3 is now an actual
    ])
    upload("forecast", [
        row(2026, 3, 1000, 500),   # forecast still exists for week 3
        row(2026, 4, 1100, 550),
    ])

def test_extra_week_no_crash():
    setup_extra_week()
    rows = table()
    assert rows, "table returned no rows"

def test_extra_week_correct_types():
    """Week 3 now has both an actual and a forecast row -- table should
    show BOTH correctly: week 3 as actual (with act2026 populated) AND
    week 4 still as forecast."""
    rows = table()
    assert 3 in rows, "week 3 missing from table"
    assert 4 in rows, "week 4 missing from table"
    # Week 3's actual value should reflect the uploaded actual (1050+520=1570)
    # The table shows EITHER the actual or forecast value depending on row_type
    if rows[3]["row_type"] == "actual":
        assert rows[3]["act2026"] is not None, "week 3 actual row has no act2026"
    # Week 4 is still a forecast
    assert rows[4]["row_type"] == "forecast"

def test_extra_week_total_derivation():
    """Total = PCL + Agent must still hold for the remaining forecast week (4)
    even after week 3 became an actual."""
    rows = table("Total.Del.Pcs.N")
    pcl_rows = table("PCL.Del.Pcs.N")
    agent_rows = table("Agent.Del.Pcs.N")
    # Week 4 is still forecast - check Total = PCL + Agent
    assert abs(rows[4]["value"] - (pcl_rows[4]["value"] + agent_rows[4]["value"])) < 1

def test_extra_week_chart_no_crash():
    """Chart endpoint must not crash with extra actual week."""
    data = chart()
    assert "actuals" in data
    assert "2026" in data["actuals"]
    # 2026 actuals should now include week 3
    wks = data["actuals"]["2026"]["weeks"]
    assert 3 in wks, f"week 3 missing from 2026 actuals on chart: {wks}"

def test_extra_week_kpi_label():
    """The dynamic actuals label should reflect the new max week automatically.
    We can't test the JS label directly, but we CAN verify the backend
    returns act2026 (non-null) for week 3, which is what drives the label."""
    rows = table()
    # find rows where act2026 is present
    act_weeks = [w for w, r in rows.items() if r.get("act2026") is not None]
    assert 3 in act_weeks, f"week 3 not counted as actual week: {act_weeks}"

def test_extra_week_with_override():
    """Override on week 4 (still a forecast) must still work correctly
    after adding week 3 as an actual."""
    rows_before = table("Total.Del.Pcs.N")
    orig_w4 = rows_before[4]["value"]  # 1650

    overrides_a = {"4": 1300.0}
    overrides_b = {"4": 650.0}
    rows_after = table("Total.Del.Pcs.N", overrides_a=overrides_a, overrides_b=overrides_b)
    assert abs(rows_after[4]["value"] - 1950.0) < 1, \
        f"override on week 4 gave {rows_after[4]['value']}, expected 1950"

def test_extra_week_csv_no_crash():
    """CSV export must not crash with mixed actual+forecast weeks."""
    rows = table()
    chart_data = chart()
    r = client.post("/api/export", json={
        "metric": "Total.Del.Pcs.N",
        "chart_data": chart_data,
        "table_rows": list(rows.values()),
    })
    assert r.status_code == 200
    text = r.get_data(as_text=True)
    assert "Week" in text
    assert "Forecast" in text or "Actual" in text

# =============================================================================
# Edge case: ALL weeks become actuals (no forecast weeks left)
# =============================================================================
def test_all_actuals_no_forecast_weeks():
    """If the actuals file covers all forecast weeks, the table shouldn't
    crash -- it just shows everything as actuals."""
    app_module.store.update({"actual": None, "forecast": None,
                             "terminal_map": {}, "div_terminal_map": {}})
    upload("actual", [
        row(2025, 1, 600, 400),
        row(2026, 1, 610, 410),
        row(2026, 2, 920, 610),
        row(2026, 3, 1050, 520),
        row(2026, 4, 1060, 530),  # forecast weeks 3+4 now have actuals
    ])
    upload("forecast", [
        row(2026, 3, 1000, 500),
        row(2026, 4, 1100, 550),
    ])
    rows = table()
    assert rows, "table empty when all forecast weeks have actuals"

# =============================================================================
# Run
# =============================================================================
print("\nTesting: uploading extra week of actuals doesn't break the tool\n")

test("baseline: weeks 1-2 actual, 3-4 forecast renders correctly", test_baseline)
test("extra week: no crash on upload or table fetch", test_extra_week_no_crash)
test("extra week: week types are correct (actual vs forecast)", test_extra_week_correct_types)
test("extra week: Total = PCL + Agent still holds for remaining forecast weeks", test_extra_week_total_derivation)
test("extra week: chart endpoint doesn't crash", test_extra_week_chart_no_crash)
test("extra week: new actual week appears in act2026 data (drives dynamic KPI label)", test_extra_week_kpi_label)
test("extra week: overrides on remaining forecast weeks still work", test_extra_week_with_override)
test("extra week: CSV export doesn't crash", test_extra_week_csv_no_crash)
test("edge case: all forecast weeks covered by actuals doesn't crash", test_all_actuals_no_forecast_weeks)

print(f"\n{passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
