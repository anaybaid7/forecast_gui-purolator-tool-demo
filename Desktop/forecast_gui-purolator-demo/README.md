# Forecast Review Tool

Internal tool for reviewing and adjusting weekly freight forecasts (PCL/Agent
delivery pieces) against prior-year actuals, with an optional 2027 Prophet
forecast overlay.

## Structure

```
app.py                  Flask backend, /api/upload /api/chart /api/table /api/export
static/
  index.html            weekly forecast page markup
  daily.html            daily distribution page (markup + its own JS)
  style.css             styling, color vars at the top
  app.js                table/chart UI, filters, edit handling
  ratio_split.js         Total <-> PCL/Agent override math (shared with tests)
prophet_pipeline/       2027/2026 Prophet forecast, see prophet_pipeline/README.md
data/                   Cyber Week / Amazon regressor spreadsheets
docs/                   pipeline_docs.html and wireframes.html (product docs)
sample_data/            historical actuals used by the Prophet pipeline
file_data/              actual.xlsx / forecast.xlsx working copies
mock_*.xlsx, mock_*.csv sample input files for local testing
tests/                  see tests/README.md
battleship-purolator-modular/   unrelated side project, a Purolator-themed
                                 multiplayer Battleship game (Express + Socket.io)
```

A previous version of this folder carried a pile of `patch_*.py` scripts that
each gzip+base64-decoded a blob into `app.py` or a file under `static/`. That
was a quick way to push fixes without re-uploading full files, but it made
the repo unreadable and impossible to diff. Those patches have all been
applied and folded into the real source files above, so the patch scripts
were removed. If you need the old patch-by-patch history, it's just not here
anymore, treat this as the clean starting point going forward.

## Running it

```bash
pip install -r requirements.txt --break-system-packages
python app.py
```

Open `http://localhost:5050`, upload an Actual.xlsx and a Forecast.xlsx, pick
a metric and filters.

## What it does

- `Total.Del.Pcs.N` is always `PCL.Del.Pcs.N + Agent.Del.Pcs.N`. Editing PCL or
  Agent updates Total automatically; editing Total splits the change between
  PCL and Agent using that week's PCL:Agent ratio from the base year's
  actuals.
- Every filter change (metric, year, division, terminal, base year, operation)
  updates the chart and table immediately -- no Apply button.
- Picking a division restricts the terminal list to that division's terminals.
- The base year's actual line is always shown on the chart for comparison.
- Weeks are shown as plain numbers (1-52) in the table, chart, and CSV export.
- CSV export matches exactly what's on screen, including any adjustments.
- Checking "Show 2027 Prophet forecast" fits a Prophet model per
  terminal/metric using the Cyber Week and Amazon regressors in `data/`, and
  overlays the 2027 prediction on the chart. Details and assumptions in
  `prophet_pipeline/README.md`.

## Tests

```bash
pip install -r requirements-dev.txt --break-system-packages
./run_tests.sh
```

See `tests/README.md`.

## Deploying

See `DEPLOYMENT.md` for running this on Render.
