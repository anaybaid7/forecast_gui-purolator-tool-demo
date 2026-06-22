"""
config.py

All the tunable assumptions for the 2027 Prophet forecast live here, so
nothing else in this package needs editing between forecasting cycles.
"""

# --- forecast horizon ---
# Forecast.xlsx already covers 2026, so this pipeline only produces 2027
# (weeks 1-52). Adding another year means bumping this and extending the
# regressor generation in regressors.py to match.
FORECAST_YEAR = 2027
WEEKS_PER_YEAR = 52

# --- training window ---
# How much actuals history to feed Prophet per series. The R script
# truncated some series to a later start year because of restructures
# (a terminal that only existed from a certain year onward). PCL/Agent
# pieces don't have that problem, so one global start year is used.
# Add per-metric overrides only if a specific metric needs less history,
# e.g. {"Agent.Del.Pcs.N": 2020}.
DEFAULT_TRAIN_START_YEAR = 2018
TRAIN_START_YEAR_OVERRIDES: dict[str, int] = {}

# --- Cyber Monday / Catchup week (2027) ---
# CyberWeekRegressor.xlsx only goes through 2026, where Cyber week was
# fiscal week 48 and Catchup was 49. The real 2027 week numbers depend on
# Purolator's fiscal calendar, which isn't available here -- this defaults
# to repeating the 2026 pattern. Update these two once the real weeks are
# known and re-run.
CYBER_WEEK_2027 = 48
CATCHUP_WEEK_2027 = 49

# --- Amazon volume (2027) ---
# AmazonRegressor.xlsx also stops at 2026. 2027 weekly Amazon volume is
# projected from 2026 using the 2025->2026 YoY growth, i.e. assuming the
# same trend continues.
#
#   "per_week" - ratio computed week-by-week (2026/2025), applied to each
#                 2026 week. Keeps the seasonal shape but can be noisy on
#                 low-volume weeks where the ratio swings widely.
#   "overall"  - one ratio (sum 2026 / sum 2025) applied to every week.
#                 Smoother, less sensitive to single-week noise.
AMAZON_2027_GROWTH_METHOD = "per_week"  # "per_week" or "overall"

# Clamp on the per-week ratio so one noisy week doesn't produce a silly
# 2027 value (the source data has weeks ranging from 0.33x to 1.4x YoY).
AMAZON_2027_RATIO_MIN = 0.5
AMAZON_2027_RATIO_MAX = 1.5

# --- Prophet settings ---
# Applied to every (terminal, metric) series. Kept simple and uniform
# rather than per-series tuned -- see prophet_pipeline/README.md for why
# the R script's per-series ARIMA tuning isn't replicated 1:1.
PROPHET_PARAMS = {
    "yearly_seasonality": True,
    "weekly_seasonality": False,   # data is already weekly-aggregated
    "daily_seasonality": False,
    "seasonality_mode": "multiplicative",
    "interval_width": 0.8,
}

# Must match column names on the regressor table built by regressors.py.
REGRESSOR_COLUMNS = ["cyber", "catchup", "amazon"]

# --- output ---
# Piece/stop counts can't be negative -- clip forecasts to zero, same idea
# as the R script's convert_to_positive() but applied to every metric here.
CLIP_NEGATIVE_TO_ZERO = True
