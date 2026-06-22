import io, csv, os
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import pandas as pd

from prophet_pipeline import pipeline as prophet_pipeline

import numpy as np

def _to_py(obj):
    """Recursively convert numpy scalars to native Python types for JSON."""
    if isinstance(obj, dict):   return {k: _to_py(v) for k,v in obj.items()}
    if isinstance(obj, list):   return [_to_py(v) for v in obj]
    if isinstance(obj, _np.integer): return int(obj)
    if isinstance(obj, _np.floating): return float(obj)
    if isinstance(obj, _np.ndarray): return obj.tolist()
    return obj

def json_safe(obj):
    """Recursively convert numpy/pandas types to native Python for JSON."""
    if isinstance(obj, dict):   return {str(k): json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):   return [json_safe(v) for v in obj]
    if isinstance(obj, tuple):  return [json_safe(v) for v in obj]
    if isinstance(obj, np.integer):  return int(obj)
    if isinstance(obj, np.floating): return float(obj)
    if isinstance(obj, np.ndarray):  return obj.tolist()
    return obj


app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

store = {"actual": None, "forecast": None, "daily_dist": None, "event_map": None,
         "terminal_map": {}, "div_terminal_map": {},
         "event_prefs": {},
         "dist_changelog": [],
         "fmr_historical": None,   # historical parquet (2012-2025), loaded once/year
         "fmr_current": None,      # current year CSV (Jan-last week), re-uploaded weekly
         "regular_weeks": [
             # Seeded from Mehrdad's helper_function.py REGULAR_WEEKS dict
             # User can modify these via the UI — these are just the starting defaults
             {"division": "ATLANTIC",              "year": 2026, "weeks": [19,17,16]},
             {"division": "SOUTH WESTERN ONTARIO", "year": 2026, "weeks": [16,17,19,22]},
             {"division": "NORTH EASTERN ONTARIO", "year": 2026, "weeks": [17,19,22]},
             {"division": "GREATER TORONTO AREA",  "year": 2026, "weeks": [16,17,18,22]},
             {"division": "PACIFIC",               "year": 2026, "weeks": [17,18,22]},
             {"division": "PRAIRIES",              "year": 2025, "weeks": [4,5,18,19]},
             {"division": "PRAIRIES",              "year": 2026, "weeks": [5,17,18]},
             {"division": "QUEBEC",                "year": 2026, "weeks": [5,6,8,16,17,18,22]},
         ]}
# dist_changelog entries: {ts, terminal, division, week, metric, day, day_name, old_pct, new_pct}

# Regressor spreadsheets used by the 2027 Prophet forecast. Shipped in the
# repo under data/ so the forecast works without any extra upload step.
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
CYBER_REGRESSOR_PATH = os.path.join(DATA_DIR, "CyberWeekRegressor.xlsx")
AMAZON_REGRESSOR_PATH = os.path.join(DATA_DIR, "AmazonRegressor.xlsx")

METRIC_COLS = [
    "PCL.Del.Pcs.N", "PCL.Del.Stops.N",
    "PCL.PU.Pcs.N",  "PCL.PU.Stops.N",
    "Agent.Del.Pcs.N","Agent.PU.Pcs.N",
    "Total.Del.Stops.N","Total.PU.Stops.N"
]
METRIC_LABELS = {
    "PCL.Del.Pcs.N":      "PCL Del Pieces",
    "PCL.Del.Stops.N":    "PCL Del Stops",
    "PCL.PU.Pcs.N":       "PCL PU Pieces",
    "PCL.PU.Stops.N":     "PCL PU Stops",
    "Agent.Del.Pcs.N":    "Agent Del Pieces",
    "Agent.PU.Pcs.N":     "Agent PU Pieces",
    "Total.Del.Stops.N":  "Total Del Stops",
    "Total.PU.Stops.N":   "Total PU Stops",
    "Total.Del.Pcs.N":    "Total Del Pieces"
}
DIVISIONS = ['ATLANTIC','GREATER TORONTO AREA','NORTH EASTERN ONTARIO',
             'PACIFIC','PRAIRIES','QUEBEC','SOUTH WESTERN ONTARIO']

# The two components that sum to Total.Del.Pcs.N
COMPONENT_A = "PCL.Del.Pcs.N"
COMPONENT_B = "Agent.Del.Pcs.N"
TOTAL_METRIC = "Total.Del.Pcs.N"


def load_df(file):
    df = pd.read_excel(file, engine="openpyxl")
    # handle alternate column names from some forecast files
    if "Week" in df.columns and "Week.Number" not in df.columns:
        df = df.rename(columns={"Week": "Week.Number"})
    df.columns = [c.replace("_EDITED", "") for c in df.columns]
    df["Terminal"]      = df["Terminal"].fillna(0).astype(int).astype(str)
    df["Terminal.Name"] = df["Terminal.Name"].fillna("").astype(str).str.strip()
    df["Division"]      = df["Division"].fillna("").astype(str).str.strip().str.upper()
    df["Year"]          = df["Year"].fillna(0).astype(int)
    df["Week.Number"]   = df["Week.Number"].fillna(0).astype(int)
    for c in METRIC_COLS:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    if COMPONENT_A in df.columns and COMPONENT_B in df.columns:
        df[TOTAL_METRIC] = df[COMPONENT_A] + df[COMPONENT_B]
    return df


def apply_filters(df, divisions, terminals):
    if divisions:
        df = df[df["Division"].isin([d.upper() for d in divisions])]
    if terminals:
        df = df[df["Terminal"].astype(str).isin([str(t) for t in terminals])]
    return df


def week_grp(df, metric, yr=None):
    d = df if yr is None else df[df["Year"] == yr]
    g = d.groupby("Week.Number")[metric].sum().reset_index()
    return {int(r["Week.Number"]): float(r[metric]) for _, r in g.iterrows()}


@app.route("/")
def index():
    return app.send_static_file("index.html")

@app.route("/daily_page")
def daily_page_route():
    return app.send_static_file("daily.html")


@app.route("/api/upload", methods=["POST"])
def upload():
    kind = request.form.get("kind")
    if kind not in ("actual", "forecast", "daily"):
        return jsonify(json_safe({"error": "kind must be actual or forecast"})), 400
    file = request.files.get("file")
    if not file:
        return jsonify(json_safe({"error": "no file"})), 400
    try:
        if kind == "daily":
            df = pd.read_excel(file, engine="openpyxl")
            df["Terminal"] = df["Terminal"].fillna(0).astype(int).astype(str)
            df["Week"] = df["Week"].fillna(0).astype(int)
            store["daily_dist"] = df
            return jsonify({"ok": True, "rows": len(df), "kind": "daily"})
        df = load_df(file)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    store[kind] = df

    if kind == "actual":
        tmap = {}
        div_terminal_map = {}
        for _, row in df[["Division", "Terminal", "Terminal.Name"]].drop_duplicates().iterrows():
            t, n, d = str(row["Terminal"]), str(row["Terminal.Name"]).strip(), str(row["Division"]).strip().upper()
            if t and n:
                tmap[t] = n
            if d:
                if d not in div_terminal_map:
                    div_terminal_map[d] = []
                if t not in div_terminal_map[d]:
                    div_terminal_map[d].append(t)
        store["terminal_map"] = tmap
        store["div_terminal_map"] = div_terminal_map

    tmap = store["terminal_map"]
    terminals_in_file = sorted(df["Terminal"].astype(str).unique().tolist(), key=lambda x: int(x) if x.isdigit() else x)
    terminal_list = [{"id": t, "name": tmap.get(str(t), ""),
                       "label": f"{t} — {tmap.get(str(t), '')}" if tmap.get(str(t)) else t}
                      for t in terminals_in_file]

    all_metrics = METRIC_COLS + [TOTAL_METRIC]
    metrics = [c for c in all_metrics if c in df.columns]
    metric_labels = {c: METRIC_LABELS.get(c, c) for c in metrics}
    years = sorted(df["Year"].unique().tolist()) if kind == "actual" else []
    divs = sorted(df["Division"].dropna().unique().tolist()) if kind == "actual" else DIVISIONS

    div_terminal_map = store.get("div_terminal_map", {})
    return jsonify({"ok": True, "rows": len(df), "terminals": terminal_list,
                    "years": years, "metrics": metrics, "metric_labels": metric_labels, "divisions": divs,
                    "div_terminal_map": div_terminal_map})


def get_filtered(kind, divisions, terminals):
    df = store.get(kind)
    if df is None:
        return None
    return apply_filters(df, divisions, terminals)


def resolve_terminals(divisions, terminals):
    """
    Terminal ids in scope for the current division/terminal filter, read
    off the actuals table. The Prophet pipeline fits one model per terminal
    and aggregates afterward, so it needs the explicit list rather than a
    pre-filtered dataframe like the chart/table endpoints use.
    """
    df_act = store.get("actual")
    if df_act is None:
        return []
    df = apply_filters(df_act, divisions, terminals)
    return sorted(df["Terminal"].astype(str).unique().tolist(), key=lambda x: int(x) if x.isdigit() else x)


@app.route("/api/chart", methods=["POST"])
def chart():
    body         = request.json
    metric       = body.get("metric", "PCL.Del.Pcs.N")
    actual_years = [int(y) for y in body.get("actual_years", [])]
    divisions    = body.get("divisions", [])
    terminals    = body.get("terminals", [])
    overrides_a  = body.get("overrides_a", {})
    overrides_b  = body.get("overrides_b", {})
    show_prophet = bool(body.get("show_prophet", False))
    result       = {"actuals": {}, "forecast": None}

    df_act = get_filtered("actual", divisions, terminals)
    df_fc  = get_filtered("forecast", divisions, terminals)

    if df_act is not None and actual_years:
        for yr in actual_years:
            wm = week_grp(df_act, metric, yr)
            weeks = sorted(wm.keys())
            result["actuals"][str(yr)] = {"weeks": weeks, "values": [round(wm[w], 1) for w in weeks]}

    if df_fc is not None:
        if metric == TOTAL_METRIC:
            fc_a = week_grp(df_fc, COMPONENT_A)
            fc_b = week_grp(df_fc, COMPONENT_B)
            weeks = sorted(set(fc_a.keys()) | set(fc_b.keys()))
            values = []
            for w in weeks:
                a_val = float(overrides_a[str(w)]) if str(w) in overrides_a else fc_a.get(w, 0.0)
                b_val = float(overrides_b[str(w)]) if str(w) in overrides_b else fc_b.get(w, 0.0)
                values.append(round(a_val + b_val, 1))
            result["forecast"] = {"weeks": weeks, "values": values}
        elif metric == COMPONENT_A:
            fc = week_grp(df_fc, metric)
            weeks = sorted(fc.keys())
            values = [round(float(overrides_a[str(w)]) if str(w) in overrides_a else fc[w], 1) for w in weeks]
            result["forecast"] = {"weeks": weeks, "values": values}
        elif metric == COMPONENT_B:
            fc = week_grp(df_fc, metric)
            weeks = sorted(fc.keys())
            values = [round(float(overrides_b[str(w)]) if str(w) in overrides_b else fc[w], 1) for w in weeks]
            result["forecast"] = {"weeks": weeks, "values": values}
        else:
            wm = week_grp(df_fc, metric)
            weeks = sorted(wm.keys())
            result["forecast"] = {"weeks": weeks, "values": [round(wm[w], 1) for w in weeks]}

    if show_prophet and store["actual"] is not None:
        try:
            scoped_terminals = resolve_terminals(divisions, terminals)
            result["prophet_2027"] = prophet_pipeline.forecast_2027_by_metric(
                actual_df=store["actual"],
                cyber_path=CYBER_REGRESSOR_PATH,
                amazon_path=AMAZON_REGRESSOR_PATH,
                terminals=scoped_terminals,
                metric=metric,
            )
        except Exception as e:
            result["prophet_error"] = str(e)

    return jsonify(result)


@app.route("/api/table", methods=["POST"])
def table():
    body        = request.json
    metric      = body.get("metric", "PCL.Del.Pcs.N")
    base_year   = int(body.get("base_year", 2025))
    divisions   = body.get("divisions", [])
    terminals   = body.get("terminals", [])
    overrides_a = body.get("overrides_a", {})
    overrides_b = body.get("overrides_b", {})

    rows_out = []

    if store["actual"] is None and store["forecast"] is None:
        return jsonify(json_safe({"rows": []}))

    df_act = get_filtered("actual", divisions, terminals)
    df_fc  = get_filtered("forecast", divisions, terminals)

    base_map    = {}
    act2026_map = {}
    base_a_map  = {}
    base_b_map  = {}

    if df_act is not None:
        base_df = df_act[df_act["Year"] == base_year]
        base_map = week_grp(base_df, metric)
        if metric in (TOTAL_METRIC, COMPONENT_A, COMPONENT_B):
            base_a_map = week_grp(base_df, COMPONENT_A)
            base_b_map = week_grp(base_df, COMPONENT_B)
        a26 = df_act[df_act["Year"] == 2026]
        act2026_map = week_grp(a26, metric)

    fc_map = {}
    fc_a_map = {}
    fc_b_map = {}
    if df_fc is not None:
        if metric == TOTAL_METRIC:
            fc_a_map = week_grp(df_fc, COMPONENT_A)
            fc_b_map = week_grp(df_fc, COMPONENT_B)
            all_w = sorted(set(fc_a_map.keys()) | set(fc_b_map.keys()))
            for w in all_w:
                fc_map[w] = fc_a_map.get(w, 0.0) + fc_b_map.get(w, 0.0)
        else:
            fc_map = week_grp(df_fc, metric)

    all_weeks = sorted(set(list(act2026_map.keys()) + list(fc_map.keys())))

    for wk in all_weeks:
        act_val  = act2026_map.get(wk)
        base_val = base_map.get(wk)

        if wk in fc_map:
            orig = round(fc_map[wk], 1)

            if metric == TOTAL_METRIC:
                a_orig = fc_a_map.get(wk, 0.0)
                b_orig = fc_b_map.get(wk, 0.0)
                a_val = float(overrides_a[str(wk)]) if str(wk) in overrides_a else a_orig
                b_val = float(overrides_b[str(wk)]) if str(wk) in overrides_b else b_orig
                fc_val = a_val + b_val
                modified = (str(wk) in overrides_a) or (str(wk) in overrides_b)
            elif metric == COMPONENT_A:
                a_orig = orig
                b_orig = None
                ov = overrides_a.get(str(wk))
                fc_val = float(ov) if ov is not None else orig
                modified = ov is not None
                a_val = fc_val
                b_val = None
            elif metric == COMPONENT_B:
                a_orig = None
                b_orig = orig
                ov = overrides_b.get(str(wk))
                fc_val = float(ov) if ov is not None else orig
                modified = ov is not None
                a_val = None
                b_val = fc_val
            else:
                a_orig = None
                b_orig = None
                fc_val = orig
                modified = False
                a_val = None
                b_val = None

            yoy_fc  = round((fc_val / base_val - 1) * 100, 1) if base_val and base_val != 0 else None
            yoy_act = round((act_val / base_val - 1) * 100, 1) if (act_val is not None and base_val and base_val != 0) else None

            rows_out.append({
                "week": wk, "label": str(wk), "row_type": "forecast",
                "base": round(base_val, 1) if base_val is not None else None,
                "act2026": round(act_val, 1) if act_val is not None else None,
                "original": orig, "value": round(fc_val, 1),
                "modified": modified, "yoy_fc": yoy_fc, "yoy_act": yoy_act,
                "base_a": round(base_a_map.get(wk, 0.0), 4) if base_a_map else None,
                "base_b": round(base_b_map.get(wk, 0.0), 4) if base_b_map else None,
                "orig_a": round(a_orig, 4) if a_orig is not None else None,
                "orig_b": round(b_orig, 4) if b_orig is not None else None,
                "fc_a": round(a_val, 4) if a_val is not None else None,
                "fc_b": round(b_val, 4) if b_val is not None else None
            })
        else:
            yoy_act = round((act_val / base_val - 1) * 100, 1) if (act_val and base_val and base_val != 0) else None
            rows_out.append({
                "week": wk, "label": str(wk), "row_type": "actual",
                "base": round(base_val, 1) if base_val is not None else None,
                "act2026": round(act_val, 1) if act_val is not None else None,
                "original": None, "value": act_val or 0,
                "modified": False, "yoy_fc": None, "yoy_act": yoy_act,
                "base_a": None, "base_b": None
            })

    return jsonify(json_safe({"rows": rows_out}))


@app.route("/api/daily", methods=["POST"])
def daily():
    """Daily volume breakdown for week-row expand on main page. Sun=1..Sat=7."""
    body       = request.json
    week       = int(body.get("week", 0))
    metric     = body.get("metric", "PCL.Del.Pcs.N")
    divisions  = body.get("divisions", [])
    terminals  = body.get("terminals", [])
    week_total = float(body.get("week_total", 0))
    pct_col    = metric + "_Pct"

    WD_ORDER = [1,2,3,4,5,6,7]
    WD_NAMES = {1:"Sunday",2:"Monday",3:"Tuesday",4:"Wednesday",
                5:"Thursday",6:"Friday",7:"Saturday"}

    daily_df = store.get("daily_dist")
    if daily_df is None or pct_col not in (daily_df.columns if daily_df is not None else []):
        default = {2:22.0,3:21.0,4:20.0,5:20.0,6:17.0,7:0.0,1:0.0}
        days_out = [{"wd":wd,"day":WD_NAMES[wd],"pct":default[wd],
                     "volume":round(week_total*default[wd]/100,1)} for wd in WD_ORDER]
        return jsonify(json_safe({"week":week,"days":days_out,"source":"default"}))

    df = daily_df[daily_df["Week"]==week].copy()
    if divisions:
        df = df[df["Division"].isin([d.upper() for d in divisions])]
    if terminals:
        df = df[df["Terminal"].astype(str).isin([str(t) for t in terminals])]
    if df.empty:
        return jsonify(json_safe({"week":week,"days":[],"source":"no_data"}))

    grp = df.groupby("Weekday")[pct_col].mean()
    total = grp.sum()
    days_out = []
    for wd in WD_ORDER:
        raw = grp.get(wd, 0)
        pct = round(raw/total*100, 4) if total > 0 else 0
        days_out.append({"wd":wd,"day":WD_NAMES[wd],"pct":pct,
                         "volume":round(week_total*pct/100,1)})
    return jsonify(json_safe({"week":week,"days":days_out,"source":"file"}))


@app.route("/api/daily_dist_page", methods=["POST"])
def daily_dist_page():
    """Powers the Daily Distribution page."""
    body          = request.json
    week          = int(body.get("week", 1))
    terminal      = str(body.get("terminal", ""))
    division      = str(body.get("division", "")).upper()
    metric        = body.get("metric", "PCL.Del.Pcs.N")
    compare_weeks = body.get("compare_weeks", [])
    pct_col       = metric + "_Pct"

    WD_ORDER = [1,2,3,4,5,6,7]
    WD_NAMES = {1:"Sunday",2:"Monday",3:"Tuesday",4:"Wednesday",
                5:"Thursday",6:"Friday",7:"Saturday"}

    daily_df = store.get("daily_dist")
    event_df = store.get("event_map")

    def get_dist(df, wk, term, div):
        d = df[df["Week"]==wk].copy()
        if term:
            d = d[d["Terminal"].astype(str)==str(term)]
        if div:
            d = d[d["Division"]==div]
        if d.empty or pct_col not in d.columns:
            return None
        grp = d.groupby("Weekday")[pct_col].mean()
        total = grp.sum()
        return {wd: round(grp.get(wd,0)/total*100,4) if total>0 else 0
                for wd in WD_ORDER}

    result = {"week":week,"metric":metric,"source":"no_data",
              "primary":None,"compare":[],"aggregated":None,"event_info":None}

    if daily_df is not None:
        primary = get_dist(daily_df, week, terminal, division)
        if primary:
            result["primary"] = [{"wd":wd,"day":WD_NAMES[wd],"pct":primary[wd]}
                                  for wd in WD_ORDER]
            result["source"] = "file"

        comp_dists = []
        for cw in compare_weeks:
            cy, cwk = int(cw.get("year",2026)), int(cw.get("week",1))
            d2 = daily_df[daily_df["Year"]==cy] if "Year" in daily_df.columns else daily_df
            dist = get_dist(d2, cwk, terminal, division)
            if dist:
                comp_dists.append({"year":cy,"week":cwk,
                    "days":[{"wd":wd,"day":WD_NAMES[wd],"pct":dist[wd]}
                             for wd in WD_ORDER]})
        result["compare"] = comp_dists

        if comp_dists:
            agg = {wd:0.0 for wd in WD_ORDER}
            for cd in comp_dists:
                for d in cd["days"]:
                    agg[d["wd"]] += d["pct"]
            n = len(comp_dists)
            total = sum(agg.values())
            result["aggregated"] = [
                {"wd":wd,"day":WD_NAMES[wd],
                 "pct":round(agg[wd]/n/total*100,4) if total>0 else 0}
                for wd in WD_ORDER]

    if event_df is not None:
        ev = event_df[event_df["Week"]==week]
        if not ev.empty:
            row = ev.iloc[0]
            bw = []
            for i in [1,2,3]:
                yr_k = f"Base.Year.{i}"; wk_k = f"Base.Week.{i}"
                if yr_k in row and pd.notna(row[yr_k]):
                    bw.append({"year":int(row[yr_k]),"week":int(row[wk_k])})
            result["event_info"] = {
                "event_name": str(row.get("Event.Name","")),
                "week_type":  str(row.get("Week.Type","event")),
                "base_weeks": bw
            }

    return jsonify(result)


@app.route("/api/save_daily_dist", methods=["POST"])
def save_daily_dist():
    """Save edited distribution, record changelog, return updated CSV."""
    import datetime
    body     = request.json
    week     = int(body.get("week",0))
    terminal = str(body.get("terminal",""))
    division = str(body.get("division","")).upper()
    metric   = body.get("metric","PCL.Del.Pcs.N")
    days     = body.get("days",[])
    pct_col  = metric + "_Pct"
    WD_NAMES = {1:"Sunday",2:"Monday",3:"Tuesday",4:"Wednesday",5:"Thursday",6:"Friday",7:"Saturday"}

    daily_df = store.get("daily_dist")
    if daily_df is None:
        return jsonify(json_safe({"error":"No distribution file loaded"})), 400

    total = sum(d["pct"] for d in days)
    if total <= 0:
        return jsonify(json_safe({"error":"Pcts sum to 0"})), 400

    new_pcts = {int(d["wd"]): d["pct"]/total*100 for d in days}
    wds = sorted(new_pcts.keys())
    new_pcts[wds[-1]] = round(100 - sum(new_pcts[w] for w in wds[:-1]), 4)
    for wd, pct in new_pcts.items():
        new_pcts[wd] = round(pct, 4)

    mask = (daily_df["Week"]==week)
    if terminal:
        mask &= (daily_df["Terminal"].astype(str)==terminal)
    if division:
        mask &= (daily_df["Division"]==division)

    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for wd, new_pct in new_pcts.items():
        old_rows = daily_df[mask & (daily_df["Weekday"]==wd)]
        old_pct = round(old_rows[pct_col].mean(), 4) if not old_rows.empty and pct_col in old_rows.columns else None
        if old_pct is not None and abs(old_pct - new_pct) > 0.001:
            store["dist_changelog"].append({
                "ts": ts, "terminal": terminal or "(all)",
                "division": division or "(all)", "week": week,
                "metric": metric, "day": wd,
                "day_name": WD_NAMES.get(wd, str(wd)),
                "old_pct": old_pct, "new_pct": new_pct,
            })
        daily_df.loc[mask & (daily_df["Weekday"]==wd), pct_col] = new_pct

    store["daily_dist"] = daily_df

    csv_buf = io.StringIO()
    daily_df.to_csv(csv_buf, index=False)
    if store["dist_changelog"]:
        csv_buf.write("\n# CHANGE LOG\n")
        csv_buf.write("# ts,terminal,division,week,metric,day,old_pct,new_pct\n")
        for e in store["dist_changelog"]:
            csv_buf.write(f"# {e['ts']},{e['terminal']},{e['division']},"
                         f"{e['week']},{e['metric']},{e['day_name']},"
                         f"{e['old_pct']},{e['new_pct']}\n")

    csv_buf.seek(0)
    kwargs = {"mimetype":"text/csv","as_attachment":True}
    import flask
    if tuple(int(x) for x in flask.__version__.split(".")[:2]) >= (2,0):
        kwargs["download_name"] = "daily_distribution_updated.csv"
    else:
        kwargs["attachment_filename"] = "daily_distribution_updated.csv"
    return send_file(io.BytesIO(csv_buf.getvalue().encode()), **kwargs)


@app.route("/api/upload_event_map", methods=["POST"])
def upload_event_map():
    """Upload event map CSV (Canada Day week, Peak weeks, etc.)"""
    file = request.files.get("file")
    if not file:
        return jsonify(json_safe({"error":"no file"})), 400
    try:
        df = pd.read_csv(file) if file.filename.endswith(".csv") else pd.read_excel(file, engine="openpyxl")
        df["Week"] = df["Week"].fillna(0).astype(int)
        store["event_map"] = df
        events = df["Event.Name"].tolist() if "Event.Name" in df.columns else []
        return jsonify({"ok":True,"rows":len(df),"events":events})
    except Exception as e:
        return jsonify({"error":str(e)}), 400


@app.route("/api/event_prefs", methods=["GET"])
def get_event_prefs():
    """Return all saved terminal event preferences."""
    return jsonify(json_safe({"prefs": store["event_prefs"]}))


@app.route("/api/event_prefs", methods=["POST"])
def save_event_pref():
    """
    Save or update a terminal-to-event-week preference.
    Body: {
      terminal: "101",
      week: 27,
      event_name: "Canada Day",
      base_weeks: [{"year":2015,"week":27}, {"year":2020,"week":28}]
    }
    """
    body       = request.json or {}
    terminal   = str(body.get("terminal", "")).strip()
    week       = str(int(body.get("week", 0)))
    event_name = str(body.get("event_name", "")).strip()
    base_weeks = body.get("base_weeks", [])

    if not terminal or not week or week == "0":
        return jsonify(json_safe({"error": "terminal and week required"})), 400

    if terminal not in store["event_prefs"]:
        store["event_prefs"][terminal] = {}

    store["event_prefs"][terminal][week] = {
        "event_name": event_name,
        "base_weeks": [{"year": int(b["year"]), "week": int(b["week"])}
                       for b in base_weeks if b.get("year") and b.get("week")]
    }
    return jsonify(json_safe({"ok": True, "terminal": terminal, "week": week}))


@app.route("/api/event_prefs/<terminal>/<int:week>", methods=["DELETE"])
def delete_event_pref(terminal, week):
    """Remove a single terminal-week preference."""
    t = store["event_prefs"].get(str(terminal), {})
    t.pop(str(week), None)
    return jsonify(json_safe({"ok": True}))




@app.route("/api/dist_changelog", methods=["GET"])
def dist_changelog():
    """Return the in-session distribution change log."""
    return jsonify(json_safe({"changelog": store["dist_changelog"]}))


@app.route("/api/event_overlays", methods=["POST"])
def event_overlays():
    """
    Given a terminal + week, return the base weeks to auto-load as overlays.
    Priority: (1) saved terminal preference, (2) global event map defaults.
    Also computes and returns the aggregated normalized distribution.
    """
    body     = request.json
    week     = int(body.get("week", 0))
    terminal = str(body.get("terminal", ""))
    division = str(body.get("division", "")).upper()
    metric   = body.get("metric", "PCL.Del.Pcs.N")
    pct_col  = metric + "_Pct"

    WD_ORDER = [1,2,3,4,5,6,7]
    WD_NAMES = {1:"Sunday",2:"Monday",3:"Tuesday",4:"Wednesday",
                5:"Thursday",6:"Friday",7:"Saturday"}

    # find base weeks: terminal pref first, then event map
    base_weeks = []
    prefs = store["event_prefs"]
    if terminal and terminal in prefs and str(week) in prefs[terminal]:
        base_weeks = prefs[terminal][str(week)].get("base_weeks", [])
    elif store["event_map"] is not None:
        ev = store["event_map"][store["event_map"]["Week"]==week]
        if not ev.empty:
            row = ev.iloc[0]
            for i in [1,2,3]:
                yr_k = f"Base.Year.{i}"; wk_k = f"Base.Week.{i}"
                if yr_k in row and pd.notna(row.get(yr_k)):
                    base_weeks.append({"year":int(row[yr_k]),"week":int(row[wk_k])})

    if not base_weeks:
        return jsonify(json_safe({"base_weeks":[], "overlays":[], "aggregated":None}))

    daily_df = store.get("daily_dist")
    if daily_df is None:
        return jsonify(json_safe({"base_weeks":base_weeks, "overlays":[], "aggregated":None}))

    def get_dist(yr, wk):
        d = daily_df.copy()
        if "Year" in d.columns:
            d = d[d["Year"]==yr]
        d = d[d["Week"]==wk]
        if terminal:
            d = d[d["Terminal"].astype(str)==str(terminal)]
        if division:
            d = d[d["Division"]==division]
        if d.empty or pct_col not in d.columns:
            return None
        grp = d.groupby("Weekday")[pct_col].mean()
        total = grp.sum()
        return {wd: round(grp.get(wd,0)/total*100,4) if total>0 else 0
                for wd in WD_ORDER}

    overlays = []
    for bw in base_weeks:
        dist = get_dist(bw["year"], bw["week"])
        if dist:
            overlays.append({
                "year": bw["year"], "week": bw["week"],
                "days": [{"wd":wd,"day":WD_NAMES[wd],"pct":dist[wd]} for wd in WD_ORDER]
            })

    # aggregated normalized average
    aggregated = None
    if overlays:
        agg = {wd: 0.0 for wd in WD_ORDER}
        for ov in overlays:
            for d in ov["days"]:
                agg[d["wd"]] += d["pct"]
        n = len(overlays)
        total = sum(agg.values())
        aggregated = [
            {"wd":wd,"day":WD_NAMES[wd],
             "pct": round(agg[wd]/n/total*100,4) if total>0 else 0}
            for wd in WD_ORDER
        ]

    return jsonify(json_safe({
        "base_weeks": base_weeks,
        "overlays": overlays,
        "aggregated": aggregated,
    }))





# ── FMR PIPELINE: Historical + Current Year Upload + Combine ─────────────────

def _fmr_combine_and_aggregate():
    """
    Combine historical parquet + current year CSV into a single weekly
    normalized actuals DataFrame. This replicates what Mehrdad's
    FMR pre-processing script does externally.

    Steps:
      1. Daily historical (2012-2025) + daily current year (Jan-last week)
      2. Remove duplicate weeks (current year may overlap tail of historical)
      3. Aggregate daily → weekly by terminal
      4. Store result in store["actual"] so the chart/table endpoints use it

    Returns (ok: bool, message: str, row_count: int)
    """
    hist = store.get("fmr_historical")
    curr = store.get("fmr_current")

    if hist is None and curr is None:
        return False, "Neither file loaded", 0

    frames = []
    if hist is not None:
        frames.append(hist)
    if curr is not None:
        frames.append(curr)

    daily = pd.concat(frames, ignore_index=True)

    # Standardize column names
    if "Week.Number" not in daily.columns and "Week" in daily.columns:
        daily = daily.rename(columns={"Week": "Week.Number"})

    # Drop duplicates: if same Terminal/Year/Week/Day in both files, keep current
    daily = daily.drop_duplicates(
        subset=["Year","Week.Number","Day","Terminal"], keep="last"
    )

    # Detect metric columns (anything ending in .N or .Pcs or .Stops)
    import re as _re
    metric_cols = [c for c in daily.columns
                   if _re.search(r'\.(Pcs|Stops|N)$', c) and c not in
                   ["Week.Number","Terminal","Division","Year","Day"]]

    if not metric_cols:
        metric_cols = ["PCL.Del.Pcs.N","Agent.Del.Pcs.N","Total.Del.Pcs.N"]
        metric_cols = [c for c in metric_cols if c in daily.columns]

    # Aggregate daily → weekly
    grp_cols = ["Year","Week.Number","Terminal"]
    optional = ["Terminal.Name","Division"]
    for col in optional:
        if col in daily.columns:
            grp_cols.append(col)

    weekly = daily.groupby(grp_cols, as_index=False)[metric_cols].sum()
    weekly["Terminal"] = weekly["Terminal"].astype(str)  # always string, never int64
    weekly = weekly.sort_values(["Year","Week.Number","Terminal"]).reset_index(drop=True)

    store["actual"] = weekly
    return True, f"Combined {len(daily):,} daily rows into {len(weekly):,} weekly rows", len(weekly)


@app.route("/api/upload_fmr_historical", methods=["POST"])
def upload_fmr_historical():
    """
    Upload the historical daily FMR file (2012-2025).
    Accepts .parquet (preferred — ~300KB for 8 terminals) or .csv/.xlsx.
    This file is uploaded ONCE PER YEAR in January.
    After upload, automatically combines with current year if loaded.
    """
    file = request.files.get("file")
    if not file:
        return jsonify(json_safe({"error": "no file"})), 400
    try:
        fname = file.filename.lower()
        if fname.endswith(".parquet"):
            import io as _io
            df = pd.read_parquet(_io.BytesIO(file.read()))
        elif fname.endswith(".csv"):
            df = pd.read_csv(file)
        else:
            df = pd.read_excel(file, engine="openpyxl")

        # Standardize
        if "Week" in df.columns and "Week.Number" not in df.columns:
            df = df.rename(columns={"Week": "Week.Number"})

        store["fmr_historical"] = df
        years = [int(y) for y in sorted(df["Year"].unique().tolist())] if "Year" in df.columns else []
        rows = len(df)

        # auto-combine if current year also loaded
        combined_msg = ""
        if store.get("fmr_current") is not None:
            ok, msg, wrows = _fmr_combine_and_aggregate()
            combined_msg = f" Combined: {msg}."

        return jsonify({
            "ok": True,
            "rows": int(rows),
            "years": [int(y) for y in years],
            "message": f"Historical loaded: {rows:,} rows, years {years[0] if years else '?'}-{years[-1] if years else '?'}.{combined_msg}"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/upload_fmr_current", methods=["POST"])
def upload_fmr_current():
    """
    Upload the current year daily actuals CSV (Jan 01 → end of last week).
    Re-uploaded every Monday after Mehrdad runs the Courier Ops pull.
    After upload, automatically combines with historical if loaded.
    """
    file = request.files.get("file")
    if not file:
        return jsonify(json_safe({"error": "no file"})), 400
    try:
        fname = file.filename.lower()
        if fname.endswith(".csv"):
            df = pd.read_csv(file)
        else:
            df = pd.read_excel(file, engine="openpyxl")

        if "Week" in df.columns and "Week.Number" not in df.columns:
            df = df.rename(columns={"Week": "Week.Number"})

        store["fmr_current"] = df
        rows   = len(df)
        weeks  = sorted(df["Week.Number"].unique().tolist()) if "Week.Number" in df.columns else []
        yr     = df["Year"].iloc[0] if "Year" in df.columns and len(df) else "?"

        # auto-combine
        combined_msg = ""
        if store.get("fmr_historical") is not None or True:  # combine even without historical
            ok, msg, wrows = _fmr_combine_and_aggregate()
            combined_msg = f" Combined: {msg}."

        return jsonify(json_safe({
            "ok": True,
            "rows": rows,
            "year": yr,
            "weeks": f"W{weeks[0] if weeks else '?'}-W{weeks[-1] if weeks else '?'}",
            "message": f"Current year loaded: {rows:,} rows, {yr} {combined_msg}"
        }))
    except Exception as e:
        return jsonify({"error": str(e)}), 400




@app.route("/api/fmr_init", methods=["GET"])
def fmr_init():
    """
    Called by frontend after FMR combine succeeds.
    Returns the same shape as /api/upload so the metric selector,
    terminal list, division buttons, and year pills all populate.
    """
    df = store.get("actual")
    if df is None:
        return jsonify(json_safe({"error": "No actuals loaded yet"})), 400

    # build terminal + division maps
    tmap = {}
    div_terminal_map = {}
    for _, row in df[["Division","Terminal","Terminal.Name"]].drop_duplicates().iterrows():
        t = str(row["Terminal"])
        n = str(row.get("Terminal.Name","")).strip()
        d = str(row.get("Division","")).strip().upper()
        if t and n: tmap[t] = n
        if d:
            div_terminal_map.setdefault(d, [])
            if t not in div_terminal_map[d]: div_terminal_map[d].append(t)
    store["terminal_map"]    = tmap
    store["div_terminal_map"]= div_terminal_map

    terminals_in_file = sorted(df["Terminal"].astype(str).unique().tolist(),
                               key=lambda x: int(x) if x.isdigit() else x)
    terminal_list = [{"id": t, "name": tmap.get(str(t),""),
                      "label": f"{t} — {tmap.get(str(t),t)}"}
                     for t in terminals_in_file]

    all_metrics = METRIC_COLS + [TOTAL_METRIC]
    metrics = [c for c in all_metrics if c in df.columns]
    metric_labels = {c: METRIC_LABELS.get(c, c) for c in metrics}
    years = [int(y) for y in sorted(df["Year"].unique().tolist())]
    divs  = sorted(df["Division"].dropna().unique().tolist())

    return jsonify(json_safe({
        "ok": True,
        "rows": int(len(df)),
        "kind": "actual",
        "terminals": terminal_list,
        "metrics": metrics,
        "metric_labels": metric_labels,
        "years": years,
        "divisions": divs,
        "div_terminal_map": div_terminal_map,
    }))

@app.route("/api/fmr_combine", methods=["POST"])
def fmr_combine():
    """Manually trigger FMR combine (historical + current → weekly actuals)."""
    ok, msg, rows = _fmr_combine_and_aggregate()
    if ok:
        return jsonify(json_safe({"ok": True, "message": msg, "rows": rows}))
    return jsonify(json_safe({"error": msg})), 400


@app.route("/api/fmr_status", methods=["GET"])
def fmr_status():
    """Return what FMR files are currently loaded."""
    hist = store.get("fmr_historical")
    curr = store.get("fmr_current")
    act  = store.get("actual")
    return jsonify({
        "historical_loaded": hist is not None,
        "historical_rows": len(hist) if hist is not None else 0,
        "historical_years": [int(y) for y in sorted(hist["Year"].unique().tolist())] if hist is not None and "Year" in hist.columns else [],
        "current_loaded": curr is not None,
        "current_rows": len(curr) if curr is not None else 0,
        "current_weeks": sorted(curr["Week.Number"].unique().tolist()) if curr is not None and "Week.Number" in curr.columns else [],
        "weekly_actuals_ready": act is not None,
        "weekly_actuals_rows": len(act) if act is not None else 0,
    })

@app.route("/api/regular_weeks", methods=["GET"])
def get_regular_weeks():
    return jsonify(json_safe({"assignments": store["regular_weeks"]}))




# ── FMR PIPELINE: Historical + Current Year Upload + Combine ─────────────────

def _fmr_combine_and_aggregate():
    """
    Combine historical parquet + current year CSV into a single weekly
    normalized actuals DataFrame. This replicates what Mehrdad's
    FMR pre-processing script does externally.

    Steps:
      1. Daily historical (2012-2025) + daily current year (Jan-last week)
      2. Remove duplicate weeks (current year may overlap tail of historical)
      3. Aggregate daily → weekly by terminal
      4. Store result in store["actual"] so the chart/table endpoints use it

    Returns (ok: bool, message: str, row_count: int)
    """
    hist = store.get("fmr_historical")
    curr = store.get("fmr_current")

    if hist is None and curr is None:
        return False, "Neither file loaded", 0

    frames = []
    if hist is not None:
        frames.append(hist)
    if curr is not None:
        frames.append(curr)

    daily = pd.concat(frames, ignore_index=True)

    # Standardize column names
    if "Week.Number" not in daily.columns and "Week" in daily.columns:
        daily = daily.rename(columns={"Week": "Week.Number"})

    # Drop duplicates: if same Terminal/Year/Week/Day in both files, keep current
    daily = daily.drop_duplicates(
        subset=["Year","Week.Number","Day","Terminal"], keep="last"
    )

    # Detect metric columns (anything ending in .N or .Pcs or .Stops)
    import re as _re
    metric_cols = [c for c in daily.columns
                   if _re.search(r'\.(Pcs|Stops|N)$', c) and c not in
                   ["Week.Number","Terminal","Division","Year","Day"]]

    if not metric_cols:
        metric_cols = ["PCL.Del.Pcs.N","Agent.Del.Pcs.N","Total.Del.Pcs.N"]
        metric_cols = [c for c in metric_cols if c in daily.columns]

    # Aggregate daily → weekly
    grp_cols = ["Year","Week.Number","Terminal"]
    optional = ["Terminal.Name","Division"]
    for col in optional:
        if col in daily.columns:
            grp_cols.append(col)

    weekly = daily.groupby(grp_cols, as_index=False)[metric_cols].sum()
    weekly["Terminal"] = weekly["Terminal"].astype(str)  # always string, never int64
    weekly = weekly.sort_values(["Year","Week.Number","Terminal"]).reset_index(drop=True)

    store["actual"] = weekly
    return True, f"Combined {len(daily):,} daily rows into {len(weekly):,} weekly rows", len(weekly)


@app.route("/api/regular_weeks", methods=["POST"])
def save_regular_week():
    body     = request.json or {}
    division = str(body.get("division","")).strip().upper()
    year     = int(body.get("year", 0))
    weeks    = [int(w) for w in body.get("weeks", []) if 1 <= int(w) <= 52]
    if not division or not year or not weeks:
        return jsonify(json_safe({"error": "division, year, and weeks required"})), 400
    # upsert: remove existing for this division+year, add new
    store["regular_weeks"] = [
        r for r in store["regular_weeks"]
        if not (r["division"].upper() == division and r["year"] == year)
    ]
    store["regular_weeks"].append({"division": division, "year": year, "weeks": sorted(weeks)})
    return jsonify(json_safe({"ok": True}))


@app.route("/api/regular_weeks/<division>/<int:year>", methods=["DELETE"])
def delete_regular_week(division, year):
    store["regular_weeks"] = [
        r for r in store["regular_weeks"]
        if not (r["division"].upper() == division.upper() and r["year"] == year)
    ]
    return jsonify(json_safe({"ok": True}))


@app.route("/api/export_regular_weeks", methods=["GET"])
def export_regular_weeks():
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Division", "Year", "Weeks"])
    for r in sorted(store["regular_weeks"], key=lambda x: (x["division"], x["year"])):
        w.writerow([r["division"], r["year"], ",".join(str(wk) for wk in r["weeks"])])
    buf.seek(0)
    kwargs = {"mimetype":"text/csv","as_attachment":True}
    import flask
    if tuple(int(x) for x in flask.__version__.split(".")[:2]) >= (2,0):
        kwargs["download_name"] = "regular_week_assignments.csv"
    else:
        kwargs["attachment_filename"] = "regular_week_assignments.csv"
    return send_file(io.BytesIO(buf.getvalue().encode()), **kwargs)


@app.route("/api/import_regular_weeks", methods=["POST"])
def import_regular_weeks():
    file = request.files.get("file")
    if not file: return jsonify(json_safe({"error": "no file"})), 400
    try:
        import csv as csv_mod
        reader = csv_mod.DictReader(io.StringIO(file.read().decode("utf-8")))
        count = 0
        for row in reader:
            div   = str(row.get("Division","")).strip().upper()
            year  = int(row.get("Year",0) or 0)
            wkstr = str(row.get("Weeks","")).strip()
            if not div or not year or not wkstr: continue
            weeks = [int(w.strip()) for w in wkstr.split(",") if w.strip().isdigit()]
            store["regular_weeks"] = [
                r for r in store["regular_weeks"]
                if not (r["division"].upper()==div and r["year"]==year)
            ]
            store["regular_weeks"].append({"division": div, "year": year, "weeks": sorted(weeks)})
            count += 1
        return jsonify(json_safe({"ok": True, "imported": count}))
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/export_event_prefs", methods=["GET"])
def export_event_prefs():
    """
    Export all terminal event preferences as CSV.
    Columns: Terminal, Event.Week, Event.Name, Base.Year.1, Base.Week.1,
             Base.Year.2, Base.Week.2, Base.Year.3, Base.Week.3
    This is the file that goes back in as input next session.
    """
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Terminal", "Event.Week", "Event.Name",
                "Base.Year.1", "Base.Week.1",
                "Base.Year.2", "Base.Week.2",
                "Base.Year.3", "Base.Week.3"])

    for terminal, weeks in sorted(store["event_prefs"].items()):
        for week, pref in sorted(weeks.items(), key=lambda x: int(x[0])):
            bws = pref.get("base_weeks", [])
            row_out = [terminal, week, pref.get("event_name", "")]
            for i in range(3):
                if i < len(bws):
                    row_out += [bws[i]["year"], bws[i]["week"]]
                else:
                    row_out += ["", ""]
            w.writerow(row_out)

    buf.seek(0)
    kwargs = {"mimetype": "text/csv", "as_attachment": True}
    import flask
    if tuple(int(x) for x in flask.__version__.split(".")[:2]) >= (2, 0):
        kwargs["download_name"] = "event_preferences.csv"
    else:
        kwargs["attachment_filename"] = "event_preferences.csv"
    return send_file(io.BytesIO(buf.getvalue().encode()), **kwargs)


@app.route("/api/import_event_prefs", methods=["POST"])
def import_event_prefs():
    """Re-import a previously exported event preferences CSV."""
    file = request.files.get("file")
    if not file:
        return jsonify(json_safe({"error": "no file"})), 400
    try:
        import csv as csv_mod
        text = file.read().decode("utf-8")
        reader = csv_mod.DictReader(io.StringIO(text))
        count = 0
        for row in reader:
            terminal = str(row.get("Terminal", "")).strip()
            week     = str(int(row.get("Event.Week", 0) or 0))
            if not terminal or week == "0":
                continue
            bws = []
            for i in [1, 2, 3]:
                yr = row.get(f"Base.Year.{i}", "")
                wk = row.get(f"Base.Week.{i}", "")
                if yr and wk:
                    try:
                        bws.append({"year": int(yr), "week": int(wk)})
                    except ValueError:
                        pass
            if terminal not in store["event_prefs"]:
                store["event_prefs"][terminal] = {}
            store["event_prefs"][terminal][week] = {
                "event_name": str(row.get("Event.Name", "")).strip(),
                "base_weeks": bws
            }
            count += 1
        return jsonify(json_safe({"ok": True, "imported": count}))
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/export", methods=["POST"])
def export_csv():
    body       = request.json
    metric     = body.get("metric", "PCL.Del.Pcs.N")
    label      = METRIC_LABELS.get(metric, metric)
    chart_data = body.get("chart_data", {})
    table_rows = body.get("table_rows", [])

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Year", "Week", "Label", "Type", label, "YoY vs Base Year %"])

    for yr, data in sorted(chart_data.get("actuals", {}).items()):
        for wk, val in zip(data["weeks"], data["values"]):
            w.writerow([yr, wk, f"{yr}-{wk}", "Actual", val, ""])

    for row in table_rows:
        wk = row["week"]
        if row["row_type"] == "forecast":
            w.writerow([2026, wk, f"2026-{wk}", "Forecast",
                        round(float(row["value"]), 1),
                        row.get("yoy_fc") if row.get("yoy_fc") is not None else ""])
        else:
            w.writerow([2026, wk, f"2026-{wk}", "Actual",
                        round(float(row["value"]), 1),
                        row.get("yoy_act") if row.get("yoy_act") is not None else ""])

    buf.seek(0)
    filename = f"forecast_{metric.replace('.', '_')}.csv"
    kwargs = {"mimetype": "text/csv", "as_attachment": True}
    import flask
    if tuple(int(x) for x in flask.__version__.split(".")[:2]) >= (2, 0):
        kwargs["download_name"] = filename
    else:
        kwargs["attachment_filename"] = filename
    return send_file(io.BytesIO(buf.getvalue().encode()), **kwargs)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print(f"\n  Forecast Tool -> http://localhost:{port}\n")
    app.run(port=port, debug=False, host="0.0.0.0")
