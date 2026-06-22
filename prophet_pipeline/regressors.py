"""
regressors.py

Loads the Cyber Week and Amazon regressor spreadsheets and produces one
weekly table covering every (Year, Week) Prophet needs, including a
generated 2027 block since neither source file has 2027 data yet.

Source file shapes:
  CyberWeekRegressor.xlsx: Year, Week, Cyber, Catchup, Type
  AmazonRegressor.xlsx:    Year, Week, AmazonWeekly, Amazon, Type, Tier2_ON

Only Cyber, Catchup, and Amazon are kept -- Tier2_ON belongs to a different
commodity series in the original R model and doesn't apply here.
"""

from __future__ import annotations

import pandas as pd

from . import config


def _load_cyber_catchup(cyber_path: str) -> pd.DataFrame:
    """Read CyberWeekRegressor.xlsx into a (Year, Week, cyber, catchup) frame."""
    df = pd.read_excel(cyber_path)
    df = df.rename(columns={"Cyber": "cyber", "Catchup": "catchup"})
    return df[["Year", "Week", "cyber", "catchup"]].copy()


def _load_amazon(amazon_path: str) -> pd.DataFrame:
    """Read AmazonRegressor.xlsx into a (Year, Week, amazon) frame."""
    df = pd.read_excel(amazon_path)
    df = df.rename(columns={"Amazon": "amazon"})
    return df[["Year", "Week", "amazon"]].copy()


def _build_2027_cyber_catchup() -> pd.DataFrame:
    """
    Generate the 2027 Cyber/Catchup rows: 52 weeks, all zero except the
    configured Cyber and Catchup weeks (see config.CYBER_WEEK_2027 /
    config.CATCHUP_WEEK_2027).
    """
    weeks = pd.DataFrame({"Year": config.FORECAST_YEAR, "Week": range(1, config.WEEKS_PER_YEAR + 1)})
    weeks["cyber"] = 0
    weeks["catchup"] = 0
    weeks.loc[weeks["Week"] == config.CYBER_WEEK_2027, "cyber"] = 1
    weeks.loc[weeks["Week"] == config.CATCHUP_WEEK_2027, "catchup"] = 1
    return weeks


def _build_2027_amazon(amazon_2025: pd.DataFrame, amazon_2026: pd.DataFrame) -> pd.DataFrame:
    """
    Project 2027 weekly Amazon volume from 2026, using the 2025->2026
    year-over-year growth as the assumed continuing trend.

    See config.AMAZON_2027_GROWTH_METHOD for the two supported approaches.
    """
    merged = amazon_2026.merge(amazon_2025, on="Week", suffixes=("_2026", "_2025"))

    if config.AMAZON_2027_GROWTH_METHOD == "overall":
        ratio = merged["amazon_2026"].sum() / merged["amazon_2025"].sum()
        merged["ratio"] = ratio
    else:  # "per_week"
        merged["ratio"] = merged["amazon_2026"] / merged["amazon_2025"]
        merged["ratio"] = merged["ratio"].clip(
            lower=config.AMAZON_2027_RATIO_MIN,
            upper=config.AMAZON_2027_RATIO_MAX,
        )

    out = pd.DataFrame({
        "Year": config.FORECAST_YEAR,
        "Week": merged["Week"],
        "amazon": merged["amazon_2026"] * merged["ratio"],
    })
    return out.sort_values("Week").reset_index(drop=True)


def build_regressor_table(cyber_path: str, amazon_path: str) -> pd.DataFrame:
    """
    Returns a single frame with columns (Year, Week, cyber, catchup, amazon)
    covering every year present in the source files plus a generated
    forecast-year (2027) block.

    This is the only function the rest of the pipeline needs to call.
    """
    cyber_catchup = _load_cyber_catchup(cyber_path)
    amazon = _load_amazon(amazon_path)

    combined = cyber_catchup.merge(amazon, on=["Year", "Week"], how="outer")
    combined[["cyber", "catchup", "amazon"]] = combined[["cyber", "catchup", "amazon"]].fillna(0)

    # --- extend into the forecast year ---
    prior_year = config.FORECAST_YEAR - 1
    two_years_ago = config.FORECAST_YEAR - 2

    amazon_prior = amazon[amazon["Year"] == prior_year][["Week", "amazon"]]
    amazon_two_ago = amazon[amazon["Year"] == two_years_ago][["Week", "amazon"]]

    if amazon_prior.empty or amazon_two_ago.empty:
        raise ValueError(
            f"Need Amazon data for {two_years_ago} and {prior_year} to project "
            f"{config.FORECAST_YEAR}, but one or both are missing from {amazon_path}."
        )

    next_cyber_catchup = _build_2027_cyber_catchup()
    next_amazon = _build_2027_amazon(amazon_two_ago, amazon_prior)

    next_year_block = next_cyber_catchup.merge(next_amazon, on=["Year", "Week"], how="left")

    full = pd.concat([combined, next_year_block], ignore_index=True)
    full = full.sort_values(["Year", "Week"]).reset_index(drop=True)
    return full
