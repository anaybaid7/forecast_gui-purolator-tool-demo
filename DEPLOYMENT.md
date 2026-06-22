# Deployment Guide

## Running locally
```bash
pip install -r requirements.txt --break-system-packages   # or use a venv
python app.py
```
Then open http://localhost:5050

## Free hosting on Render (no credit card required)

1. Create a free account at https://render.com and connect your GitHub account.
2. Push this folder to a new GitHub repository (see "Quick GitHub setup" below).
3. In Render, click **New > Web Service**, pick your repo.
4. Render should auto-detect `render.yaml`. If not, set manually:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120`
   - **Plan:** Free
5. Click **Create Web Service**. After the build finishes (~2 min) you'll get a URL like
   `https://forecast-review-tool.onrender.com` — share this with anyone.

### Notes on the free plan
- The service "sleeps" after ~15 minutes of inactivity and takes ~30-60 seconds to wake
  up on the next request. This is normal and free.
- Uploaded Excel files are kept **in memory only** (not written to disk), so if the
  service restarts/sleeps and wakes up, users will need to re-upload Actual/Forecast
  files. This is expected for a stateless free-tier deployment.
- Each visitor's uploads are shared across that single running instance (there's one
  in-memory `store`). If multiple people use it at once, the most recently uploaded
  files apply to everyone. For a shared review session this is usually fine; if you need
  per-user isolation later, that requires a small session/auth layer.
- `prophet` adds about 40MB to the install and a noticeable chunk to build time
  (the package bundles a precompiled model, so no compile step is needed at runtime —
  but pip still has to download and unpack it). Still comfortably within Render's
  free-tier limits. The 2027 Prophet forecast itself takes roughly 1-2 seconds per
  terminal on first request after an upload, then is cached until the next upload.

## Quick GitHub setup (if you don't already have a repo)
```bash
cd forecast_tool
git init
git add .
git commit -m "Forecast review tool"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```
Then point Render at that repo.

## Alternative: Desktop app for a single user
If you'd rather hand someone a double-clickable app instead of a URL, this Flask app can
be packaged with `pyinstaller` into a single executable that opens a browser tab. Ask if
you'd like this packaged — it's a separate build step from the web deployment above.
