"""
model.py
--------
Thin wrapper around Prophet for a single (terminal, metric) series. Keeping
this isolated from series_builder.py and pipeline.py means the model itself
-- and its parameters in config.PROPHET_PARAMS -- can be swapped or tuned
without touching how data flows in and out.
"""

from __future__ import annotations

import logging

import pandas as pd
from prophet import Prophet

from . import config

# Prophet/cmdstanpy are chatty by default; keep the app's logs readable.
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
logging.getLogger("prophet").setLevel(logging.WARNING)


def fit_and_predict(train: pd.DataFrame, future: pd.DataFrame) -> pd.DataFrame:
    """
    Fit a Prophet model on `train` (output of series_builder.build_series)
    and predict over `future` (output of series_builder.build_future_frame).

    Returns a frame with columns: Year, Week, yhat -- the forecast for
    config.FORECAST_YEAR, clipped to zero if config.CLIP_NEGATIVE_TO_ZERO.
    """
    model = Prophet(**config.PROPHET_PARAMS)

    for col in config.REGRESSOR_COLUMNS:
        model.add_regressor(col)

    model.fit(train[["ds", "y", *config.REGRESSOR_COLUMNS]])

    forecast = model.predict(future[["ds", *config.REGRESSOR_COLUMNS]])

    result = future[["Year", "Week"]].copy()
    result["yhat"] = forecast["yhat"].values

    if config.CLIP_NEGATIVE_TO_ZERO:
        result["yhat"] = result["yhat"].clip(lower=0)

    return result
