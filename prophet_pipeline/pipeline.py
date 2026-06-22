"""
pipeline.py

Entry point the Flask app calls for the 2027 forecast.

Prophet is fit per terminal, per metric (PCL.Del.Pcs.N and Agent.Del.Pcs.N --
Total is never fit directly, it's just PCL + Agent like everywhere else in
the tool). Fitting per terminal keeps each terminal's own seasonality and
regressor response intact; we sum the predictions afterward depending on
which terminals are in the current division/terminal filter.

Refitting ~20 models on every filter change would be slow, so results are
cached per (terminal, metric, hash of that terminal's data). Re-uploading
Actual/Forecast changes the hash, so the cache invalidates itself -- no
manual reset needed.
"""

from __future__ import annotations

import hashlib

import pandas as pd

from . import config
from . import regressors
from . import series_builder
from . import model as model_module

# Module-level cache: {(terminal, metric, data_hash): forecast_df}
# Cleared automatically as soon as the underlying data changes (the hash
# changes), so this never serves stale results after a re-upload.
_forecast_cache: dict[tuple[str, str, str], pd.DataFrame] = {}

COMPONENT_METRICS = ["PCL.Del.Pcs.N", "Agent.Del.Pcs.N"]
TOTAL_METRIC = "Total.Del.Pcs.N"


def _data_hash(df: pd.DataFrame) -> str:
    """Cheap fingerprint of a dataframe's content, used as a cache key."""
    return hashlib.md5(pd.util.hash_pandas_object(df, index=True).values).hexdigest()


def _forecast_one_series(actual_df: pd.DataFrame, terminal: str, metric: str,
                          regressor_table: pd.DataFrame, data_hash: str) -> pd.DataFrame:
    """Fit (or fetch from cache) the 2027 forecast for one (terminal, metric)."""
    cache_key = (terminal, metric, data_hash)
    if cache_key in _forecast_cache:
        return _forecast_cache[cache_key]

    train = series_builder.build_series(actual_df, terminal, metric, regressor_table)
    future = series_builder.build_future_frame(regressor_table)

    # Not enough history to fit a seasonal model -- skip rather than error,
    # so one sparse terminal doesn't break the forecast for everyone else.
    if len(train) < config.WEEKS_PER_YEAR * 2:
        result = future[["Year", "Week"]].copy()
        result["yhat"] = 0.0
    else:
        result = model_module.fit_and_predict(train, future)

    _forecast_cache[cache_key] = result
    return result


def forecast_2027(actual_df: pd.DataFrame, cyber_path: str, amazon_path: str,
                   terminals: list[str]) -> dict[str, list]:
    """
    2027 forecast for Total.Del.Pcs.N, summed across `terminals`. Returns
    {"weeks": [...], "values": [...]} -- the shape /api/chart's
    `prophet_2027` field expects.
    """
    regressor_table = regressors.build_regressor_table(cyber_path, amazon_path)
    data_hash = _data_hash(actual_df)

    weekly_totals = pd.Series(0.0, index=range(1, config.WEEKS_PER_YEAR + 1))

    for terminal in terminals:
        component_sum = pd.Series(0.0, index=range(1, config.WEEKS_PER_YEAR + 1))
        for metric in COMPONENT_METRICS:
            fc = _forecast_one_series(actual_df, terminal, metric, regressor_table, data_hash)
            component_sum = component_sum.add(
                fc.set_index("Week")["yhat"], fill_value=0.0
            )
        weekly_totals = weekly_totals.add(component_sum, fill_value=0.0)

    weeks = weekly_totals.index.tolist()
    values = [round(float(v), 1) for v in weekly_totals.values]
    return {"weeks": weeks, "values": values}


def forecast_2027_by_metric(actual_df: pd.DataFrame, cyber_path: str, amazon_path: str,
                             terminals: list[str], metric: str) -> dict[str, list]:
    """
    Same as forecast_2027 but for any single metric (PCL, Agent, or Total),
    so the chart's Prophet overlay matches whatever metric is selected.
    """
    regressor_table = regressors.build_regressor_table(cyber_path, amazon_path)
    data_hash = _data_hash(actual_df)

    metrics_to_sum = COMPONENT_METRICS if metric == TOTAL_METRIC else [metric]

    weekly_totals = pd.Series(0.0, index=range(1, config.WEEKS_PER_YEAR + 1))
    for terminal in terminals:
        for m in metrics_to_sum:
            fc = _forecast_one_series(actual_df, terminal, m, regressor_table, data_hash)
            weekly_totals = weekly_totals.add(fc.set_index("Week")["yhat"], fill_value=0.0)

    weeks = weekly_totals.index.tolist()
    values = [round(float(v), 1) for v in weekly_totals.values]
    return {"weeks": weeks, "values": values}
