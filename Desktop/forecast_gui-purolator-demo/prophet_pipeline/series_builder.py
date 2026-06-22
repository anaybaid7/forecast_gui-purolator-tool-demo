"""
series_builder.py

Turns the wide (Terminal, Year, Week.Number, <metrics...>) actuals table the
app already loads into the long (ds, y, regressors...) shape Prophet wants,
one series per (terminal, metric).

`ds` uses the Monday of the ISO week -- exact date doesn't matter beyond
giving Prophet a regular weekly cadence, and (Year, Week) is kept alongside
so results map straight back onto the table/chart endpoints with no date
math on the way out.
"""

from __future__ import annotations

import pandas as pd

from . import config


def _week_to_date(year: int, week: int) -> pd.Timestamp:
    """Monday of ISO week `week` in `year`. Handles week 53 automatically."""
    # %G/%V/%u = ISO year, ISO week, ISO weekday (1 = Monday)
    return pd.to_datetime(f"{year}-{week:02d}-1", format="%G-%V-%u")


def build_series(actual_df: pd.DataFrame, terminal: str, metric: str,
                  regressor_table: pd.DataFrame) -> pd.DataFrame:
    """
    Training frame for one (terminal, metric): ds, y, Year, Week, and the
    regressor columns, from config.DEFAULT_TRAIN_START_YEAR (or a per-metric
    override) onward. `metric` is PCL or Agent -- Total is never built
    directly, it's summed from the two after forecasting (see pipeline.py).
    """
    start_year = config.TRAIN_START_YEAR_OVERRIDES.get(metric, config.DEFAULT_TRAIN_START_YEAR)

    df = actual_df[
        (actual_df["Terminal"] == str(terminal)) &
        (actual_df["Year"] >= start_year)
    ][["Year", "Week.Number", metric]].copy()

    df = df.rename(columns={"Week.Number": "Week", metric: "y"})
    df = df.groupby(["Year", "Week"], as_index=False)["y"].sum()

    df = df.merge(regressor_table, on=["Year", "Week"], how="left")
    df[config.REGRESSOR_COLUMNS] = df[config.REGRESSOR_COLUMNS].fillna(0)

    df["ds"] = df.apply(lambda r: _week_to_date(int(r["Year"]), int(r["Week"])), axis=1)
    df = df.sort_values("ds").reset_index(drop=True)

    return df[["ds", "y", "Year", "Week", *config.REGRESSOR_COLUMNS]]


def build_future_frame(regressor_table: pd.DataFrame) -> pd.DataFrame:
    """
    The (ds, Year, Week, regressors...) frame for config.FORECAST_YEAR --
    shared across every series since the regressors don't vary by terminal.
    """
    future = regressor_table[regressor_table["Year"] == config.FORECAST_YEAR].copy()
    future["ds"] = future.apply(lambda r: _week_to_date(int(r["Year"]), int(r["Week"])), axis=1)
    future = future.sort_values("ds").reset_index(drop=True)
    return future[["ds", "Year", "Week", *config.REGRESSOR_COLUMNS]]
