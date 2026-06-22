# 2027 Prophet Forecast — Design Notes

This folder adds a 2027 forecast option for `Total.Del.Pcs.N` (and its two
components, `PCL.Del.Pcs.N` and `Agent.Del.Pcs.N`) to the forecast review tool.
It's wired in through `/api/chart` — checking "Show 2027 Prophet forecast" in
the sidebar adds a `prophet_2027` series to the chart response, which the
frontend already knew how to draw (dark green dotted line).

## Where this came from

The starting point was Ayanna's R script (`R Output Results_New.R` /
`Output_Results.R`), which forecasts ~20 commodity-level series using
`stlf()` with ARIMA errors, fed two external regressors:

- **CyberWeekRegressor.xlsx** — two flags, `Cyber` and `Catchup`, marking the
  week of Cyber Monday and the week right after it. Order volume spikes hard
  in the Cyber week and stays elevated the week after as the backlog clears.
- **AmazonRegressor.xlsx** — weekly Amazon parcel volume, which is a big
  enough share of total volume that it materially shifts the seasonal
  pattern (note the spike to ~400k in 2026 weeks 48-49 in the file — that's
  the same Cyber week effect showing up in the Amazon numbers too).

The R script also does a few things that are specific to its own schema and
don't carry over:

- **Per-series start years.** Some commodity series only exist from a certain
  year onward (terminal restructures, new service lines), so the R script
  truncates training data per series. `PCL.Del.Pcs.N` and `Agent.Del.Pcs.N`
  don't have this problem — they're stable across the full history — so this
  pipeline uses one global start year (`config.DEFAULT_TRAIN_START_YEAR`,
  currently 2018) with a per-metric override dict available if a future
  metric needs it.

- **The "NHO subtraction" pattern.** A handful of series in the R script are
  forecast as `(NHO + HUB combined) - (HUB alone)`, because the combined
  series was the one with enough history to model. `PCL.Del.Pcs.N` and
  `Agent.Del.Pcs.N` are already atomic — there's nothing to subtract. Total
  is just `PCL + Agent`, same as the rest of this tool.

- **NHO Tier2-Con-N and HUB PM-NonAmz Con-N** use non-ARIMA shortcuts
  (percentage-of-Amazon, YoY rollforward) that are specific to those two
  series and don't apply here.

So: same two regressors, same overall idea (seasonal model + Cyber/Amazon as
external regressors), reimplemented in Python with Prophet instead of
`stlf()`/ARIMA, scoped to the two metrics this tool actually tracks.

## File-by-file

**`config.py`** — every tunable lives here. Training start year, Prophet
parameters, and — most importantly — the assumptions used to project the
regressors into 2027 (see below). If next year's forecast cycle needs
different numbers, this is the only file that should need editing.

**`regressors.py`** — loads both regressor spreadsheets and returns one
table covering 2017 (or whenever the source data starts) through 2027. The
2027 rows are generated, not loaded, because neither source file has 2027
data yet:

- *Cyber/Catchup 2027*: defaults to the same week numbers as 2026 (week 48
  for Cyber, 49 for Catchup). The real 2027 week numbers depend on
  Purolator's fiscal calendar, which I don't have a mapping for — update
  `CYBER_WEEK_2027` / `CATCHUP_WEEK_2027` in config.py once known and rerun.
- *Amazon 2027*: projected from 2026 using the 2025→2026 year-over-year
  growth ratio, computed week-by-week and clamped to 0.5x–1.5x so one noisy
  week doesn't produce a silly outlier. Can be switched to a single overall
  ratio via `AMAZON_2027_GROWTH_METHOD = "overall"` if the per-week ratios
  turn out too jumpy in practice.

**`series_builder.py`** — reshapes the wide actuals table (one row per
terminal/year/week, one column per metric) into the long `(ds, y, regressors)`
format Prophet wants, one series per `(terminal, metric)`. Also builds the
shared 2027 future frame that every series predicts over.

**`model.py`** — the actual Prophet call. One function, `fit_and_predict`,
takes a training frame and a future frame and returns the 2027 forecast.
Negative forecasts are clipped to zero (piece counts can't go negative).

**`pipeline.py`** — orchestration + caching. Fits one model per
`(terminal, metric)`, caches the result in memory keyed on a hash of that
terminal's data, and sums across whichever terminals match the current
division/terminal filter. Two entry points:

- `forecast_2027(...)` — Total only, across a terminal list.
- `forecast_2027_by_metric(...)` — any of the three metrics, used by
  `/api/chart` so the Prophet overlay matches whatever metric is currently
  selected.

## Why fit per terminal instead of on the aggregate

Each terminal has its own volume scale and its own sensitivity to the Cyber
and Amazon regressors — a terminal that handles a lot of Amazon parcels will
see a much bigger Cyber-week bump, proportionally, than one that doesn't.
Fitting one model on pre-summed totals would blur that out. Fitting per
terminal and summing the *predictions* keeps each terminal's seasonality
intact. The tradeoff is more model fits, which is why results are cached —
switching division/terminal filters re-aggregates cached predictions instead
of refitting.

## Performance

On the test data (2 terminals, 9 years of weekly history), 4 model fits
(2 terminals × {PCL, Agent}) took about 1 second total. With ~10-15 real
terminals that's roughly 5-8 seconds for the first request after an upload,
then near-instant afterward since results are cached until new files are
uploaded.

## What this doesn't do (yet)

- No 2026 Prophet comparison (`showProphet2026` / "Prophet AI" source toggle
  in the sidebar) — those UI elements exist but aren't wired to anything.
  The pipeline here only covers 2027.
- No retraining trigger beyond re-uploading Actual/Forecast files. If the
  regressor spreadsheets in `data/` are updated, the cache won't know unless
  the actuals file is also re-uploaded (since the cache key is based on the
  actuals hash, not the regressor files). If regressor-only updates become
  common, the cache key should include a hash of the regressor files too —
  easy one-line change in `pipeline._data_hash` if needed.
