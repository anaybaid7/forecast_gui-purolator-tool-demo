"""
conftest.py

Shared fixtures for the backend test suite.

`client` resets the module-level `store` dict before handing back a fresh
Flask test client -- without this, uploads from one test would leak into
the next (the app keeps everything in memory by design, see DEPLOYMENT.md).

`sample_data` uploads a small, hand-computed Actual/Forecast dataset through
the real /api/upload endpoint, so tests go through the same load_df() path
the app uses in production.
"""

import io

import pandas as pd
import pytest

import app as app_module


@pytest.fixture
def client():
    app_module.store["actual"] = None
    app_module.store["forecast"] = None
    app_module.store["terminal_map"] = {}
    app_module.store["div_terminal_map"] = {}
    return app_module.app.test_client()


def _excel_bytes(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    buf.seek(0)
    return buf.read()


# ---------------------------------------------------------------------------
# Sample data
# ---------------------------------------------------------------------------
# One terminal, one division, two years of actuals (2025 = base year, 2026
# weeks 1-2 = "actual so far") and a 2-week forecast (2026 weeks 3-4).
#
# Numbers are chosen so the PCL:Agent ratio is a clean, easy-to-check 60:40
# in the base year, and PCL != Agent in the forecast so Total really is doing
# something (i.e. it's not just 2x one number).
#
#               PCL   Agent   Total   PCL:Agent ratio
# 2025 wk1     600     400    1000    60:40
# 2025 wk2     900     600    1500    60:40
# 2026 wk1     610     410    1020    (actual, not used as base)
# 2026 wk2     920     610    1530    (actual, not used as base)
# 2026 wk3(F) 1000     500    1500    forecast, week 3
# 2026 wk4(F) 1100     550    1650    forecast, week 4

ACTUAL_ROWS = [
    {"Terminal": "101", "Terminal.Name": "Test Terminal", "Division": "QUEBEC",
     "Year": 2025, "Week.Number": 1, "PCL.Del.Pcs.N": 600, "Agent.Del.Pcs.N": 400,
     "PCL.Del.Stops.N": 0, "PCL.PU.Pcs.N": 0, "PCL.PU.Stops.N": 0,
     "Agent.PU.Pcs.N": 0, "Total.Del.Stops.N": 0, "Total.PU.Stops.N": 0},
    {"Terminal": "101", "Terminal.Name": "Test Terminal", "Division": "QUEBEC",
     "Year": 2025, "Week.Number": 2, "PCL.Del.Pcs.N": 900, "Agent.Del.Pcs.N": 600,
     "PCL.Del.Stops.N": 0, "PCL.PU.Pcs.N": 0, "PCL.PU.Stops.N": 0,
     "Agent.PU.Pcs.N": 0, "Total.Del.Stops.N": 0, "Total.PU.Stops.N": 0},
    {"Terminal": "101", "Terminal.Name": "Test Terminal", "Division": "QUEBEC",
     "Year": 2026, "Week.Number": 1, "PCL.Del.Pcs.N": 610, "Agent.Del.Pcs.N": 410,
     "PCL.Del.Stops.N": 0, "PCL.PU.Pcs.N": 0, "PCL.PU.Stops.N": 0,
     "Agent.PU.Pcs.N": 0, "Total.Del.Stops.N": 0, "Total.PU.Stops.N": 0},
    {"Terminal": "101", "Terminal.Name": "Test Terminal", "Division": "QUEBEC",
     "Year": 2026, "Week.Number": 2, "PCL.Del.Pcs.N": 920, "Agent.Del.Pcs.N": 610,
     "PCL.Del.Stops.N": 0, "PCL.PU.Pcs.N": 0, "PCL.PU.Stops.N": 0,
     "Agent.PU.Pcs.N": 0, "Total.Del.Stops.N": 0, "Total.PU.Stops.N": 0},
]

FORECAST_ROWS = [
    {"Terminal": "101", "Terminal.Name": "Test Terminal", "Division": "QUEBEC",
     "Year": 2026, "Week.Number": 3, "PCL.Del.Pcs.N": 1000, "Agent.Del.Pcs.N": 500,
     "PCL.Del.Stops.N": 0, "PCL.PU.Pcs.N": 0, "PCL.PU.Stops.N": 0,
     "Agent.PU.Pcs.N": 0, "Total.Del.Stops.N": 0, "Total.PU.Stops.N": 0},
    {"Terminal": "101", "Terminal.Name": "Test Terminal", "Division": "QUEBEC",
     "Year": 2026, "Week.Number": 4, "PCL.Del.Pcs.N": 1100, "Agent.Del.Pcs.N": 550,
     "PCL.Del.Stops.N": 0, "PCL.PU.Pcs.N": 0, "PCL.PU.Stops.N": 0,
     "Agent.PU.Pcs.N": 0, "Total.Del.Stops.N": 0, "Total.PU.Stops.N": 0},
]


@pytest.fixture
def sample_data(client):
    """Upload the standard Actual + Forecast sample through /api/upload."""
    actual_bytes = _excel_bytes(pd.DataFrame(ACTUAL_ROWS))
    forecast_bytes = _excel_bytes(pd.DataFrame(FORECAST_ROWS))

    r1 = client.post("/api/upload", data={
        "kind": "actual",
        "file": (io.BytesIO(actual_bytes), "actual.xlsx"),
    }, content_type="multipart/form-data")
    assert r1.status_code == 200
    assert r1.get_json()["ok"] is True

    r2 = client.post("/api/upload", data={
        "kind": "forecast",
        "file": (io.BytesIO(forecast_bytes), "forecast.xlsx"),
    }, content_type="multipart/form-data")
    assert r2.status_code == 200
    assert r2.get_json()["ok"] is True

    return client
