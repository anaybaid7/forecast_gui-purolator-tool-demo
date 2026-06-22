"""
prophet_pipeline
-----------------
2027 Prophet forecast for the PCL/Agent pieces metrics, built from the same
Cyber Week and Amazon regressors used in the original R forecasting script.

Usage from app.py:

    from prophet_pipeline import pipeline as prophet_pipeline

    result = prophet_pipeline.forecast_2027_by_metric(
        actual_df=store["actual"],
        cyber_path="data/CyberWeekRegressor.xlsx",
        amazon_path="data/AmazonRegressor.xlsx",
        terminals=["101", "202"],
        metric="Total.Del.Pcs.N",
    )
    # -> {"weeks": [1, 2, ..., 52], "values": [...]}

See README.md in this folder for the full design write-up, and config.py for
every tunable assumption (training window, 2027 regressor projections,
Prophet parameters).
"""

from . import pipeline, config, regressors, series_builder, model

__all__ = ["pipeline", "config", "regressors", "series_builder", "model"]
