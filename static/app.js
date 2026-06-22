// ===== STATE =====
let allTerminals = [];
let selectedTerminals = new Set();
let selectedDivisions = new Set();
let selectedYears = new Set();
let allDivisions = [];
let chartData = null;
// per-component overrides; Total is always derived from these two
let overridesA = {}; // PCL.Del.Pcs.N  {week: value}
let overridesB = {}; // Agent.Del.Pcs.N {week: value}
let tableRows = [];
let chart = null;
let selectedCells = new Set();
let anchorCell = null;
let isDragging = false;
let sortCol = 'week', sortDir = 1;
let currentMetric = '';
let forecastSource = 'original'; // 'original' | 'prophet'
let divTerminalMap = {};
let weekNums = [];

// Change log: [{id, week, op, val, result, overridesA, overridesB, ts}]
// Each Apply press appends a snapshot. The chart always shows the latest state.
// Original forecast line is always kept separately on the chart.
let changeLog = [];
let changeLogCounter = 0;

// Per-week value stack for step-by-step revert.
// weekValueStack[week] = [val1, val2, ...] where last is most recent.
// Revert pops the last, so you go back one step not all the way to original.
let weekValueStack = {}; // {week: [number, ...]}

// COMPONENT_A / COMPONENT_B / TOTAL_METRIC / computeOverrides come from ratio_split.js
let metricLabels = {
  "PCL.Del.Pcs.N":     "PCL Del Pieces",
  "PCL.Del.Stops.N":   "PCL Del Stops",
  "PCL.PU.Pcs.N":      "PCL PU Pieces",
  "PCL.PU.Stops.N":    "PCL PU Stops",
  "Agent.Del.Pcs.N":   "Agent Del Pieces",
  "Agent.PU.Pcs.N":    "Agent PU Pieces",
  "Total.Del.Stops.N": "Total Del Stops",
  "Total.PU.Stops.N":  "Total PU Stops",
  "Total.Del.Pcs.N":   "Total Del Pieces"
};

// ===== FORECAST SOURCE =====
function setForecastSource(src) {
  forecastSource = src;
  document.getElementById('srcOrigBtn').classList.toggle('active', src==='original');
  document.getElementById('srcProphetBtn').classList.toggle('active', src==='prophet');
  overridesA = {}; overridesB = {};
  runChart();
}

// ===== UPLOAD =====
async function uploadFMR(input, kind) {
  const file = input.files[0];
  if (!file) return;
  const tagId    = kind === 'historical' ? 'tag-fmr-hist' : 'tag-fmr-curr';
  const endpoint = kind === 'historical' ? '/api/upload_fmr_historical' : '/api/upload_fmr_current';
  const tag      = document.getElementById(tagId);
  const statusEl = document.getElementById('fmr-status-msg');
  tag.textContent = 'Uploading...';

  const fd = new FormData();
  fd.append('file', file);
  try {
    const res  = await fetch(endpoint, {method:'POST', body:fd});
    const data = await res.json();
    if (data.ok) {
      tag.textContent = file.name;
      statusEl.textContent = data.message || 'Loaded.';
      statusEl.style.color = '#107c10';

      // populate all UI selectors from the combined weekly actuals
      const initRes  = await fetch('/api/fmr_init');
      const initData = await initRes.json();
      if (initData.ok) {
        // reuse the same handler as normal upload
        handleUploadResponse(initData);
        statusEl.textContent = (data.message || '') + ' Chart ready.';
      }
    } else {
      tag.textContent = 'Error: ' + (data.error || 'unknown');
      tag.style.color = '#c00';
      statusEl.textContent = 'Error: ' + (data.error || '');
      statusEl.style.color = '#c00';
    }
  } catch(e) {
    tag.textContent = 'Upload failed';
    statusEl.textContent = String(e);
    statusEl.style.color = '#c00';
    console.error(e);
  }
}

function handleUploadResponse(data) {
  // shared handler for both /api/upload and /api/fmr_init responses
  // populates metric selector, year grid, division grid, terminal list
  if (!data || !data.ok) return;

  if (data.metric_labels) Object.assign(metricLabels, data.metric_labels);
  if (data.div_terminal_map) Object.assign(divTerminalMap, data.div_terminal_map);

  if (data.kind === 'actual' || data.years) {
    if (data.years) {
      renderYearGrid(data.years);
      renderBaseYearSelect(data.years);
      syncBaseYearIntoActualYears();
    }
    if (data.divisions) {
      allDivisions = data.divisions;
      renderDivisionGrid(allDivisions);
    }
  }

  if (data.terminals && data.terminals.length) {
    const existing = new Map(allTerminals.map(t => [t.id, t]));
    data.terminals.forEach(t => {
      if (!existing.has(t.id) || !existing.get(t.id).name) existing.set(t.id, t);
    });
    allTerminals = [...existing.values()].sort((a,b) => {
      const na=parseInt(a.id), nb=parseInt(b.id);
      return isNaN(na)||isNaN(nb) ? a.id.localeCompare(b.id) : na-nb;
    });
    renderTerminals('');
  }

  if (data.metrics && data.metrics.length) {
    const sel  = document.getElementById('metricSel');
    const prev = sel.value;
    sel.innerHTML = '';
    data.metrics.forEach(m => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = (data.metric_labels && data.metric_labels[m]) ? data.metric_labels[m] : m;
      sel.appendChild(o);
    });
    if (prev && data.metrics.includes(prev)) sel.value = prev;
    else sel.value = data.metrics[0] || '';
    currentMetric = sel.value;
  }

  runChart();
}

async function uploadFile(input, kind) {
  if (!input.files[0]) return;
  setStat('Uploading ' + kind + '…');
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', input.files[0]);
  try {
    const res = await fetch('/api/upload', {method:'POST', body:fd});
    const data = await res.json();
    if (data.error) { setStat('Error: ' + data.error); return; }
    const tag = document.getElementById('tag-' + kind);
    tag.textContent = input.files[0].name;
    tag.style.borderStyle = 'solid';

    if (data.metric_labels) Object.assign(metricLabels, data.metric_labels);
    if (data.div_terminal_map) Object.assign(divTerminalMap, data.div_terminal_map);

    // daily distribution upload only needs the tag update, no chart refresh needed
    if (kind === 'daily') { setStat('Daily distribution loaded (' + data.rows + ' rows)'); return; }

    if (kind === 'actual') {
      renderYearGrid(data.years);
      renderBaseYearSelect(data.years);
      syncBaseYearIntoActualYears();
      allDivisions = data.divisions || [];
      renderDivisionGrid(allDivisions);
    }

    if (data.terminals && data.terminals.length) {
      const existing = new Map(allTerminals.map(t => [t.id, t]));
      data.terminals.forEach(t => { if (!existing.has(t.id) || !existing.get(t.id).name) existing.set(t.id, t); });
      allTerminals = [...existing.values()].sort((a,b) => {
        const na=parseInt(a.id), nb=parseInt(b.id);
        return isNaN(na)||isNaN(nb) ? a.id.localeCompare(b.id) : na-nb;
      });
      renderTerminals('');
    }

    if (data.metrics && data.metrics.length) {
      const sel = document.getElementById('metricSel');
      const prev = sel.value;
      sel.innerHTML = '';
      data.metrics.forEach(m => {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = metricLabels[m] || m;
        sel.appendChild(o);
      });
      if (prev && data.metrics.includes(prev)) sel.value = prev;
      currentMetric = sel.value;
    }

    document.getElementById('runBtn').disabled = false;
    setStat(kind + ' loaded  ·  ' + data.rows.toLocaleString() + ' rows');
    if (currentMetric) runChart();
  } catch(e) { setStat('Error: ' + e.message); }
  input.value = '';
}

// ===== DIVISION GRID =====
function renderDivisionGrid(divs) {
  const grid = document.getElementById('divGrid');
  grid.innerHTML = '';
  divs.forEach(d => {
    const b = document.createElement('div');
    const shortName = d.replace('GREATER TORONTO AREA','GTA')
                       .replace('NORTH EASTERN ONTARIO','NEO')
                       .replace('SOUTH WESTERN ONTARIO','SWO');
    b.className = 'div-btn' + (selectedDivisions.has(d) ? ' on' : '');
    b.textContent = shortName;
    b.title = d;
    b.onclick = () => {
      if (selectedDivisions.has(d)) {
        selectedDivisions.delete(d); b.classList.remove('on');
        // Drop terminals belonging only to the deselected division
        const remainingDivTerminals = new Set([...selectedDivisions].flatMap(sd => divTerminalMap[sd]||[]));
        (divTerminalMap[d]||[]).forEach(t => { if (!remainingDivTerminals.has(t)) selectedTerminals.delete(t); });
      } else {
        selectedDivisions.add(d); b.classList.add('on');
        // Select all terminals in the newly chosen division
        (divTerminalMap[d]||[]).forEach(t => selectedTerminals.add(t));
        // If other terminals were selected that don't belong to ANY selected division, drop them
        const allowed = new Set([...selectedDivisions].flatMap(sd => divTerminalMap[sd]||[]));
        [...selectedTerminals].forEach(t => { if (!allowed.has(t)) selectedTerminals.delete(t); });
      }
      renderTerminals(document.getElementById('tSearch').value);
      updateDivCount();
      runChart();
    };
    grid.appendChild(b);
  });
  updateDivCount();
}
function selAllDivisions() {
  allDivisions.forEach(d => selectedDivisions.add(d));
  selectedTerminals.clear();
  allDivisions.forEach(d => (divTerminalMap[d]||[]).forEach(t => selectedTerminals.add(t)));
  renderDivisionGrid(allDivisions);
  renderTerminals(document.getElementById('tSearch').value);
  runChart();
}
function clearDivisions() {
  selectedDivisions.clear();
  renderDivisionGrid(allDivisions);
  renderTerminals(document.getElementById('tSearch').value);
  runChart();
}
function updateDivCount() {
  document.getElementById('divCount').textContent = selectedDivisions.size ? '(' + selectedDivisions.size + ')' : '(all)';
}

// ===== YEAR GRID =====
function renderYearGrid(years) {
  const grid = document.getElementById('yearGrid');
  grid.innerHTML = '';
  years.forEach(yr => {
    const b = document.createElement('div');
    b.className = 'yr-btn' + (selectedYears.has(yr) ? ' on' : '');
    b.textContent = yr;
    b.onclick = () => { toggleYear(yr, b); };
    grid.appendChild(b);
  });
  updateYrCount();
}
function renderBaseYearSelect(years) {
  const sel = document.getElementById('baseYearSel');
  sel.innerHTML = '';
  [...years].reverse().forEach(yr => {
    const o = document.createElement('option');
    o.value = yr; o.textContent = yr;
    if (yr === 2025) o.selected = true;
    sel.appendChild(o);
  });
}
function toggleYear(yr, btn) {
  if (selectedYears.has(yr)) { selectedYears.delete(yr); btn.classList.remove('on'); }
  else { selectedYears.add(yr); btn.classList.add('on'); }
  updateYrCount();
  runChart();
}
function selAllYears() { document.querySelectorAll('.yr-btn').forEach(b => { selectedYears.add(+b.textContent); b.classList.add('on'); }); updateYrCount(); runChart(); }
function clearYears() { selectedYears.clear(); document.querySelectorAll('.yr-btn').forEach(b => b.classList.remove('on')); updateYrCount(); runChart(); }
function updateYrCount() { document.getElementById('yrCount').textContent = selectedYears.size ? '(' + selectedYears.size + ')' : ''; }

// Whatever year is picked as the Base Year is always shown on the chart
// (see runChart), so reflect that in the Actual Years grid too. Switching
// the base year SWAPS the selection: the previously-selected base year is
// deselected and the new one is selected. Doesn't touch any other years the
// user picked independently.
let prevBaseYear = null;
function syncBaseYearIntoActualYears() {
  const baseYear = +document.getElementById('baseYearSel').value;
  if (baseYear === prevBaseYear) return;

  if (prevBaseYear != null && selectedYears.has(prevBaseYear)) {
    selectedYears.delete(prevBaseYear);
    document.querySelectorAll('.yr-btn').forEach(b => {
      if (+b.textContent === prevBaseYear) b.classList.remove('on');
    });
  }

  selectedYears.add(baseYear);
  document.querySelectorAll('.yr-btn').forEach(b => {
    if (+b.textContent === baseYear) b.classList.add('on');
  });

  updateYrCount();
  prevBaseYear = baseYear;
}
function onBaseYearChange() {
  syncBaseYearIntoActualYears();
  runChart();
}

// ===== TERMINAL LIST =====
function visibleTerminals() {
  if (!selectedDivisions.size) return allTerminals;
  const allowed = new Set([...selectedDivisions].flatMap(sd => divTerminalMap[sd]||[]));
  return allTerminals.filter(t => allowed.has(t.id));
}
function renderTerminals(search) {
  const el = document.getElementById('fl-Terminal');
  el.innerHTML = '';
  const lo = search.toLowerCase();
  visibleTerminals().forEach(t => {
    if (lo && !t.label.toLowerCase().includes(lo)) return;
    const d = document.createElement('div');
    const sel = selectedTerminals.has(t.id);
    d.className = 'filter-item' + (sel ? ' selected' : '');
    d.innerHTML = `<span class="chk">${sel?'':''}</span><span class="tid">${t.id}</span><span>${t.name||''}</span>`;
    d.onclick = () => {
      if (selectedTerminals.has(t.id)) { selectedTerminals.delete(t.id); d.classList.remove('selected'); d.querySelector('.chk').textContent=''; }
      else { selectedTerminals.add(t.id); d.classList.add('selected'); d.querySelector('.chk').textContent=''; }
      updateTCount();
      runChart();
    };
    el.appendChild(d);
  });
  updateTCount();
}
function selectAllTerminals() { visibleTerminals().forEach(t => selectedTerminals.add(t.id)); renderTerminals(document.getElementById('tSearch').value); runChart(); }
function clearTerminals() { visibleTerminals().forEach(t => selectedTerminals.delete(t.id)); renderTerminals(document.getElementById('tSearch').value); runChart(); }
function updateTCount() {
  const n = selectedTerminals.size;
  document.getElementById('tCount').textContent = n ? '(' + n + ' of ' + visibleTerminals().length + ')' : '(all)';
}

// ===== RUN =====
let runSeq = 0;
async function runChart() {
  currentMetric = document.getElementById('metricSel').value;
  if (!currentMetric) return;
  const mySeq = ++runSeq;
  document.getElementById('runBtn').disabled = true;
  document.getElementById('spin').style.display = 'inline';

  const divisions = selectedDivisions.size ? [...selectedDivisions] : [];
  const terminals = selectedTerminals.size ? [...selectedTerminals] : [];
  const baseYear  = +document.getElementById('baseYearSel').value;
  const show2027  = document.getElementById('show2027').checked;
  const showProphet2026 = document.getElementById('showProphet2026').checked;
  // 2026 prophet comparison isn't wired up yet -- only show2027 hits the pipeline
  const needProphet = show2027 || showProphet2026;

  // Always include the base year on the chart so it overlays with the forecast
  const actualYears = new Set([...selectedYears].map(Number));
  actualYears.add(baseYear);

  // Prophet status
  if (needProphet) {
    const st = document.getElementById('prophetStatus');
    st.textContent = 'Running Prophet model…';
    st.className = 'running';
  }

  try {
    const [chartRes, tableRes] = await Promise.all([
      fetch('/api/chart', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          metric: currentMetric,
          actual_years: [...actualYears],
          divisions, terminals,
          overrides_a: overridesA, overrides_b: overridesB,
          show_prophet: needProphet
        })}),
      fetch('/api/table', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          metric: currentMetric, base_year: baseYear, divisions, terminals,
          overrides_a: overridesA, overrides_b: overridesB, forecast_source: forecastSource
        })})
    ]);

    if (mySeq !== runSeq) return; // a newer request superseded this one

    chartData  = await chartRes.json();
    const tdata = await tableRes.json();
    if (mySeq !== runSeq) return;
    tableRows  = tdata.rows;

    // Prophet status
    if (needProphet) {
      const st = document.getElementById('prophetStatus');
      if (chartData.prophet_2027 || chartData.prophet_2026) {
        st.textContent = 'Prophet model ready';
        st.className = 'done';
      } else if (chartData.prophet_error) {
        st.textContent = 'Prophet error: ' + chartData.prophet_error;
        st.className = 'error';
      } else {
        st.textContent = 'Prophet unavailable';
        st.className = 'error';
      }
    } else {
      document.getElementById('prophetStatus').textContent = '';
    }

    drawChart();
    renderKPIs(baseYear);
    renderTable();

    document.getElementById('ttl').textContent = metricLabels[currentMetric] || currentMetric;
    const termLabel = terminals.length ? terminals.length + ' terminal(s)' : 'All terminals';
    const divLabel  = divisions.length ? divisions.map(d=>d.replace('GREATER TORONTO AREA','GTA').replace('NORTH EASTERN ONTARIO','NEO').replace('SOUTH WESTERN ONTARIO','SWO')).join(', ') : 'All divisions';
    setStat(divLabel + '  ·  ' + termLabel);
    document.getElementById('exportBtn').disabled = false;
  } catch(e) {
    setStat('Error: ' + e.message);
    console.error(e);
    document.getElementById('prophetStatus').textContent = 'Error running Prophet';
    document.getElementById('prophetStatus').className = 'error';
  }

  if (mySeq === runSeq) {
    document.getElementById('runBtn').disabled = false;
    document.getElementById('spin').style.display = 'none';
  }
}

// ===== KPI TILES =====
function renderKPIs(baseYear) {
  const bar = document.getElementById('kpi-bar');
  bar.innerHTML = '';
  if (!tableRows.length) return;

  const validFc  = tableRows.filter(r => r.yoy_fc  !== null);
  const validAct = tableRows.filter(r => r.yoy_act !== null);

  const avgYoyFc  = validFc.length  ? validFc.reduce((s,r)=>s+r.yoy_fc,0)/validFc.length   : null;
  const avgYoyAct = validAct.length ? validAct.reduce((s,r)=>s+r.yoy_act,0)/validAct.length : null;

  // Build the actual week range label dynamically from whichever weeks
  // have 2026 actuals -- so it updates automatically as new weeks come in
  const actWeeks = validAct.map(r => r.week).sort((a,b) => a-b);
  const actLabel = actWeeks.length
    ? `W${actWeeks[0]}\u2013W${actWeeks[actWeeks.length-1]}`
    : 'Actuals';

  const totalFc  = tableRows.reduce((s,r)=>s+r.value,0);
  const totalBase = tableRows.reduce((s,r)=>s+(r.base||0),0);
  const yoyTotal  = totalBase ? (totalFc/totalBase-1)*100 : null;

  const srcLabel = forecastSource === 'prophet' ? 'Prophet Forecast' : 'Forecast';

  const tiles = [
    {label:'Avg YoY ' + srcLabel + ' %', val:avgYoyFc,  fmt:'pct'},
    {label:'Avg YoY Actual % (' + actLabel + ')', val:avgYoyAct, fmt:'pct'},
    {label:'Total ' + srcLabel + ' Volume', val:totalFc, fmt:'num'},
    {label:'YoY Total ' + srcLabel + ' vs '+baseYear, val:yoyTotal, fmt:'pct'},
  ];

  tiles.forEach(t => {
    if (t.val === null) return;
    const sign = t.val >= 0 ? '+' : '';
    const dispVal = t.fmt === 'pct'
      ? sign + t.val.toFixed(1) + '%'
      : Math.round(t.val).toLocaleString();
    const cls = t.fmt === 'pct' ? (t.val >= 0 ? 'green' : 'red') : '';
    const div = document.createElement('div');
    div.className = 'kpi';
    div.innerHTML = `<div class="kpi-val ${cls}">${dispVal}</div><div class="kpi-lbl">${t.label}</div>`;
    bar.appendChild(div);
  });
}

// ===== DRAW CHART =====
const YR_COLORS = ['#555','#888','#aaa','#7030a0','#2e75b6','#70ad47','#ffc000','#4472c4','#ed7d31'];

function drawChart() {
  const baseYear = +document.getElementById('baseYearSel').value;

  const allW = new Set();
  Object.values(chartData.actuals||{}).forEach(d => (d.weeks||[]).forEach(w => allW.add(w)));
  if (chartData.forecast) (chartData.forecast.weeks||[]).forEach(w => allW.add(w));
  if (chartData.prophet_2026) (chartData.prophet_2026.weeks||[]).forEach(w => allW.add(w));
  weekNums = [...allW].sort((a,b)=>a-b);

  // Labels: just the 52 weeks. Both 2026 and 2027 Prophet overlay on same positions.
  const allLabels = weekNums.map(w => `${w}`);
  const allIdxMap = {}; weekNums.forEach((w,i) => { allIdxMap[`2026-${w}`]=i; allIdxMap[`2027-${w}`]=i; });

  const datasets = [];

  // Prior year actuals - grey tones; base year gets a distinct highlighted style
  const sortedYears = Object.keys(chartData.actuals||{}).sort().filter(y => +y !== 2026);
  sortedYears.forEach((yr, i) => {
    const d = chartData.actuals[yr];
    const wm = {};
    (d.weeks||[]).forEach((w,j) => wm[w] = d.values[j]);
    const pts = new Array(allLabels.length).fill(null);
    weekNums.forEach(w => { const idx=allIdxMap[`2026-${w}`]; if(idx!=null) pts[idx]=wm[w]??null; });
    const isBase = +yr === baseYear;
    datasets.push({
      label: 'Actual ' + yr + (isBase ? ' (Base Year)' : ''),
      data: pts,
      borderColor: isBase ? '#7030a0' : YR_COLORS[i % YR_COLORS.length],
      backgroundColor: 'transparent',
      borderWidth: isBase ? 2.5 : 1.5,
      borderDash: isBase ? [] : [],
      pointRadius: 0, pointHoverRadius: isBase ? 4 : 3,
      tension:.2, spanGaps:false,
      order: isBase ? 0 : 5
    });
  });

  // 2026 actuals - RED solid
  if (chartData.actuals['2026']) {
    const d = chartData.actuals['2026'];
    const wm = {};
    (d.weeks||[]).forEach((w,j) => wm[w] = d.values[j]);
    const pts = new Array(allLabels.length).fill(null);
    weekNums.forEach(w => { const idx=allIdxMap[`2026-${w}`]; if(idx!=null) pts[idx]=wm[w]??null; });
    datasets.push({
      label: 'Actual 2026' + (baseYear===2026?' (Base Year)':''),
      data: pts,
      borderColor: '#c00',
      backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension:.2, spanGaps:false
    });
  }

  // Forecast 2026 (already reflects any overrides - computed server-side) - BLACK dotted
  if (chartData.forecast) {
    const fcm = {};
    (chartData.forecast.weeks||[]).forEach((w,j) => fcm[w] = chartData.forecast.values[j]);
    const pts = new Array(allLabels.length).fill(null);
    weekNums.forEach(w => { const idx=allIdxMap[`2026-${w}`]; if(idx!=null) pts[idx]=fcm[w]??null; });

    // Modified points: weeks where tableRows.value differs from tableRows.original
    const modWeeks = new Set(
      tableRows.filter(r => r.row_type==='forecast' && r.modified).map(r => r.week)
    );
    const modPts = new Array(allLabels.length).fill(null);
    weekNums.forEach(w => {
      const idx=allIdxMap[`2026-${w}`];
      if(idx!=null && modWeeks.has(w)) modPts[idx]=fcm[w];
    });

    // Original forecast line -- only shown when there are modifications,
    // so the user can see both what was originally forecast and the new line.
    const hasModifications = modWeeks.size > 0;
    if(hasModifications) {
      const origPts = new Array(allLabels.length).fill(null);
      tableRows.filter(r => r.row_type==='forecast').forEach(r => {
        const idx = allIdxMap[`2026-${r.week}`];
        if(idx != null) origPts[idx] = r.original;
      });
      datasets.push({
        label: 'Original Forecast',
        data: origPts,
        borderColor: '#aaa', borderWidth: 1.5, borderDash: [4,4],
        pointRadius: 0, pointHoverRadius: 3,
        backgroundColor: 'transparent', tension:.3, fill:false, spanGaps:false
      });
    }

    datasets.push({
      label: 'Forecast 2026',
      data: pts,
      borderColor: '#222', borderWidth: 2, borderDash: [6,3],
      pointRadius: 0, pointHoverRadius: 4,
      backgroundColor: 'transparent', tension:.3, fill:false, spanGaps:false
    });
    datasets.push({
      label: 'Modified',
      data: modPts,
      borderColor: '#e65100', backgroundColor: 'rgba(230,81,0,.2)',
      borderWidth: 0, pointRadius: 6, showLine: false
    });
  }

  // Prophet 2026 - blue-green solid (optional overlay)
  const showProphet2026 = document.getElementById('showProphet2026').checked;
  if (chartData.prophet_2026 && showProphet2026) {
    const pm = {};
    (chartData.prophet_2026.weeks||[]).forEach((w,j) => pm[w]=chartData.prophet_2026.values[j]);
    const pts = new Array(allLabels.length).fill(null);
    weekNums.forEach(w => { const idx=allIdxMap[`2026-${w}`]; if(idx!=null) pts[idx]=pm[w]??null; });
    datasets.push({
      label: 'Prophet 2026',
      data: pts,
      borderColor: '#1b8a3a', borderWidth: 2, borderDash: [3,3],
      pointRadius: 0, pointHoverRadius: 4,
      backgroundColor: 'transparent', tension:.3, spanGaps:false
    });
  }

  // Prophet 2027 - overlaid on same weeks as 2026 (dark green dotted)
  const show2027 = document.getElementById('show2027').checked;
  if (chartData.prophet_2027 && show2027) {
    const pm27 = {};
    (chartData.prophet_2027.weeks||[]).forEach((w,j) => pm27[w]=chartData.prophet_2027.values[j]);
    const pts = new Array(allLabels.length).fill(null);
    weekNums.forEach(w => { const idx=allIdxMap[`2027-${w}`]; if(idx!=null) pts[idx]=pm27[w]??null; });
    datasets.push({
      label: 'Prophet 2027',
      data: pts,
      borderColor: '#145214', borderWidth: 2.5, borderDash: [8,4],
      pointRadius: 0, pointHoverRadius: 4,
      backgroundColor: 'transparent', tension:.3, spanGaps:false
    });
  }

  // Crosshair plugin
  const crosshair = {
    id:'crosshair',
    afterDraw(chart) {
      if (!chart.tooltip._active||!chart.tooltip._active.length) return;
      const x = chart.tooltip._active[0].element.x;
      const {top,bottom} = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x,top); ctx.lineTo(x,bottom);
      ctx.lineWidth=1; ctx.strokeStyle='rgba(0,0,0,0.15)';
      ctx.setLineDash([4,3]); ctx.stroke(); ctx.restore();
    }
  };

  // Period boundary plugin -- Purolator's fiscal year splits 52 weeks into
  // 4-4-5 / 4-4-5 / 4-4-5 / 4-4-5 periods (13 weeks per quarter). Draw a
  // light vertical line after the last week of each period (weeks 4, 8, 13,
  // 17, 21, 26, 30, 34, 39, 43, 47) so the period structure is visible at a
  // glance without cluttering the chart.
  const PERIOD_END_WEEKS = [4, 8, 13, 17, 21, 26, 30, 34, 39, 43, 47];
  const periodLines = {
    id:'periodLines',
    afterDraw(chart) {
      const {top, bottom} = chart.chartArea;
      const ctx = chart.ctx;
      const xScale = chart.scales.x;
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5,4]);
      PERIOD_END_WEEKS.forEach(endWeek => {
        const iEnd = allIdxMap[`2026-${endWeek}`];
        const iNext = allIdxMap[`2026-${endWeek+1}`];
        if (iEnd == null || iNext == null) return;
        const x = (xScale.getPixelForValue(iEnd) + xScale.getPixelForValue(iNext)) / 2;
        ctx.beginPath();
        ctx.moveTo(x, top); ctx.lineTo(x, bottom);
        ctx.stroke();
      });
      ctx.restore();
    }
  };

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('ch'), {
    plugins: [crosshair, periodLines],
    type: 'line',
    data: {labels: allLabels, datasets},
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      plugins: {
        legend:{display:true, position:'top', labels:{font:{size:10},boxWidth:12,padding:10,
          filter:item=>item.text!=='Modified'||(Object.keys(overridesA).length>0||Object.keys(overridesB).length>0)}},
        tooltip:{
          callbacks:{
            title: items => {
              const lbl = allLabels[items[0].dataIndex];
              if (lbl && lbl.startsWith('27-')) {
                const w = parseInt(lbl.slice(3));
                return `2027 Week ${w}`;
              }
              const w = weekNums[items[0].dataIndex];
              return w ? 'Week '+w : lbl;
            },
            label: c => c.parsed.y!=null?'  '+c.dataset.label+':  '+Math.round(c.parsed.y).toLocaleString():null,
          },
          backgroundColor:'rgba(255,255,255,0.97)',
          borderColor:'#ddd',borderWidth:1,
          titleColor:'#333',bodyColor:'#444',
          titleFont:{weight:'bold',size:11},bodyFont:{size:11},padding:10
        }
      },
      scales:{
        x:{
          ticks:{font:{size:9},maxRotation:0,autoSkip:true,maxTicksLimit:56,
            callback:(val,idx)=>{
              const lbl = allLabels[idx];
              if (!lbl) return '';
              if (lbl.startsWith('27-')) return lbl.slice(3);
              const w = weekNums[idx];
              return w==null ? '' : String(w);
            }},
          grid:{color:'#f0f0f0', lineWidth:1}
        },
        y:{ticks:{font:{size:10},callback:v=>v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'K':v},grid:{color:'#f0f0f0'}}
      }
    }
  });
}

function redrawForecast() {
  if (!chart||!chartData) return;
  drawChart();
}

// ===== TABLE =====
function renderTable() {
  const tb = document.getElementById('tb');
  if (!tableRows.length) {
    tb.innerHTML='<tr><td colspan="7" style="color:#bbb;padding:20px;text-align:center">No forecast data for selected filters.</td></tr>';
    return;
  }

  const sorted = [...tableRows].sort((a,b)=>{
    let va=a[sortCol]??-Infinity, vb=b[sortCol]??-Infinity;
    return sortDir*(typeof va==='string'?va.localeCompare(vb):va-vb);
  });

  tb.innerHTML='';

  sorted.forEach((row, rowIdx) => {
    const isM = !!row.modified;
    const isProphet = forecastSource === 'prophet' && row.row_type === 'forecast';

    const tr = document.createElement('tr');
    if (isM) tr.className='mod-row';
    else if (row.row_type==='actual') tr.className='actual-row';
    tr.dataset.week=row.week; tr.dataset.idx=rowIdx;

    const td0=document.createElement('td');
    td0.style.whiteSpace='nowrap';
    if(row.row_type === 'forecast') {
      const btn = document.createElement('button');
      btn.className = 'day-expand-btn';
      btn.dataset.wk = row.week;
      btn.textContent = '>';
      btn.title = 'Expand daily breakdown';
      btn.onclick = (e) => { e.stopPropagation(); toggleDailyRow(row, tr, btn); };
      td0.appendChild(btn);
      td0.appendChild(document.createTextNode(' ' + row.label));
    } else {
      td0.textContent = row.label;
    }

    const td1=document.createElement('td');
    td1.className='cell'; td1.dataset.col='base'; td1.dataset.week=row.week;
    td1.textContent=row.base!=null?Math.round(row.base).toLocaleString():'-';

    const td2=document.createElement('td');
    td2.className='cell'; td2.dataset.col='act2026'; td2.dataset.week=row.week;
    td2.textContent=row.act2026!=null?Math.round(row.act2026).toLocaleString():'-';

    const td3=document.createElement('td');
    td3.className='cell'; td3.dataset.col='value'; td3.dataset.week=row.week;
    if (row.row_type==='actual') {
      td3.innerHTML='<span style="color:#bbb">-</span>';
      td3.style.cursor='default';
    } else {
      let cls = isProphet ? 'fp' : (isM ? 'fm' : 'fc');
      td3.innerHTML=`<span class="${cls}">${Math.round(row.value).toLocaleString()}</span>`;
    }

    const td4=document.createElement('td');
    td4.className='cell'; td4.dataset.col='yoy_act'; td4.dataset.week=row.week;
    if (row.yoy_act!=null) {
      const sign=row.yoy_act>=0?'+':'';
      td4.innerHTML='<span class="'+(row.yoy_act>=0?'yoy-p':'yoy-n')+'">'+sign+row.yoy_act.toFixed(1)+'%</span>';
    } else td4.textContent='-';

    const td5=document.createElement('td');
    td5.className='cell'; td5.dataset.col='yoy_fc'; td5.dataset.week=row.week;
    if (row.yoy_fc!=null) {
      const sign=row.yoy_fc>=0?'+':'';
      td5.innerHTML='<span class="'+(row.yoy_fc>=0?'yoy-p':'yoy-n')+'">'+sign+row.yoy_fc.toFixed(1)+'%</span>';
    } else td5.textContent='-';

    const td6=document.createElement('td');
    if (isProphet && !isM) {
      td6.innerHTML='<span class="pill pp">Prophet</span>';
    } else {
      td6.innerHTML='<span class="pill '+(isM?'pm">Modified':'pa">Base')+'</span>';
    }

    tr.addEventListener('mousedown', e=>{
      const rowCells=[td1,td2,td3,td4,td5];
      if (e.shiftKey) {
        const already=selectedCells.has(td3);
        if (already) { rowCells.forEach(td=>{td.classList.remove('selected','anchor');selectedCells.delete(td);}); selectedWeeks.delete(row.week); if(anchorCell===td3)anchorCell=null; }
        else { rowCells.forEach(td=>{td.classList.add('selected');selectedCells.add(td);}); selectedWeeks.add(row.week); }
      } else if (e.ctrlKey||e.metaKey) {
        const already=selectedCells.has(td3);
        if (already) { rowCells.forEach(td=>{td.classList.remove('selected','anchor');selectedCells.delete(td);}); selectedWeeks.delete(row.week); if(anchorCell===td3)anchorCell=null; }
        else { rowCells.forEach(td=>{td.classList.add('selected');selectedCells.add(td);}); selectedWeeks.add(row.week); if(anchorCell)anchorCell.classList.remove('anchor'); anchorCell=td3; td3.classList.add('anchor'); }
      } else {
        clearSel();
        rowCells.forEach(td=>{td.classList.add('selected');selectedCells.add(td);});
        selectedWeeks.add(row.week);
        if(anchorCell)anchorCell.classList.remove('anchor'); anchorCell=td3; td3.classList.add('anchor');
      }
      updateRef(); e.preventDefault();
    });

    if (row.row_type!=='actual') td3.addEventListener('dblclick',()=>inlineEdit(td3,row));

    tr.append(td0,td1,td2,td3,td4,td5,td6);
    tb.appendChild(tr);
  });

  reapplySelection();
}

// ===== DAILY BREAKDOWN =====
let expandedWeeks = new Set(); // tracks which weeks have their daily row open
let dailyChartInstance = null;

async function toggleDailyRow(row, weekTr, btn) {
  const wk = row.week;

  // If already expanded, collapse it
  if (expandedWeeks.has(wk)) {
    expandedWeeks.delete(wk);
    btn.textContent = '>';
    const existingRow = document.getElementById(`daily-row-${wk}`);
    if (existingRow) existingRow.remove();
    if (window._dailyDataCache) delete window._dailyDataCache[wk];
    updateWeekComparisonChart();
    return;
  }

  expandedWeeks.add(wk);
  btn.textContent = 'v';

  // fetch daily breakdown from backend
  const body = {
    week: wk,
    metric: currentMetric || 'PCL.Del.Pcs.N',
    divisions: [...selectedDivisions],
    terminals: [...selectedTerminals].map(t => t.id || t),
    week_total: row.value,
  };

  let data;
  try {
    const res = await fetch('/api/daily', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    data = await res.json();
  } catch(e) {
    console.error('daily fetch failed', e);
    return;
  }
  // cache for comparison chart
  window._dailyDataCache = window._dailyDataCache || {};
  window._dailyDataCache[wk] = data.days;

  // Build the sub-row spanning all 7 columns
  const subTr = document.createElement('tr');
  subTr.id = `daily-row-${wk}`;
  subTr.className = 'daily-sub-row';
  const subTd = document.createElement('td');
  subTd.colSpan = 7;
  subTd.style.padding = '0';

  const container = document.createElement('div');
  container.className = 'daily-container';
  container.style.cssText = 'display:flex;gap:16px;padding:10px 14px;background:#f8fbff;border-top:2px solid #0070c0;align-items:flex-start;flex-wrap:wrap';

  // Day table — shows Sun-Sat volumes and %s for this week
  const tbl = document.createElement('table');
  tbl.className = 'daily-table';
  tbl.style.cssText = 'min-width:220px;font-size:11px;border-collapse:collapse';

  if (!data.days || data.days.length === 0) {
    // no daily dist file loaded — show message
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = 'font-size:11px;color:#888;padding:8px;min-width:200px';
    msgDiv.textContent = 'Upload a Daily Dist file (sidebar) to see day-level breakdown.';
    container.appendChild(msgDiv);
  } else {
    tbl.innerHTML = `<thead><tr style="background:#e8f0fe">
      <th style="padding:4px 8px;text-align:left;font-size:10px;font-weight:700;color:#0070c0">Day</th>
      <th style="padding:4px 8px;text-align:right;font-size:10px;font-weight:700;color:#0070c0">Volume</th>
      <th style="padding:4px 8px;text-align:right;font-size:10px;font-weight:700;color:#0070c0">% of Wk</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    data.days.forEach(d => {
      const tr2 = document.createElement('tr');
      tr2.innerHTML = `
        <td style="padding:3px 8px;font-weight:600;color:#444;border-bottom:1px solid #eef">${d.day}</td>
        <td style="padding:3px 8px;text-align:right;font-family:monospace;border-bottom:1px solid #eef">${Math.round(d.volume||0).toLocaleString()}</td>
        <td style="padding:3px 8px;text-align:right;color:#0070c0;font-weight:600;border-bottom:1px solid #eef">${(d.pct||0).toFixed(1)}%</td>
      `;
      tbody.appendChild(tr2);
    });
    tbl.appendChild(tbody);
    container.appendChild(tbl);
  }

  // Mini chart canvas
  const canvas = document.createElement('canvas');
  canvas.id = `daily-chart-${wk}`;
  canvas.style.cssText = 'height:130px;width:280px;flex-shrink:0';

  container.appendChild(canvas);
  subTd.appendChild(container);
  subTr.appendChild(subTd);

  // Insert after the week row
  weekTr.insertAdjacentElement('afterend', subTr);

  // Draw mini chart — only if days data exists
  const days = data.days;
  if (days && days.length > 0 && days.some(d => d.pct > 0)) {
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: days.map(d => d.day.slice(0,3)),
        datasets: [{
          label: `W${wk}`,
          data: days.map(d => +(d.pct||0).toFixed(2)),
          borderColor: '#0070c0', borderWidth: 2,
          pointRadius: 3, tension: 0.3,
          backgroundColor: 'rgba(0,112,192,0.08)', fill: true,
        }]
      },
      options: {
        responsive: false, maintainAspectRatio: false,
        plugins: { legend:{display:false}, tooltip:{callbacks:{label:c=>`${c.parsed.y.toFixed(1)}%`}} },
        scales: {
          x: {ticks:{font:{size:10}}},
          y: {min:0, ticks:{font:{size:10}, callback: v => v.toFixed(0)+'%'}}
        }
      }
    });
  } else {
    canvas.style.display = 'none';
  }

  // If 2+ weeks are expanded, update or create a combined comparison chart
  updateWeekComparisonChart();
}

function updateWeekComparisonChart() {
  // Collect all currently expanded weeks data
  const expanded = [...expandedWeeks];
  if (expanded.length < 2) {
    // hide comparison chart if only 1 week
    const cmp = document.getElementById('week-comparison-chart-wrap');
    if (cmp) cmp.style.display = 'none';
    return;
  }

  // Get or create the comparison panel (sits above the table)
  const tblWrap = document.getElementById('tbl-wrap');
  let cmpWrap = document.getElementById('week-comparison-chart-wrap');
  if (!cmpWrap) {
    cmpWrap = document.createElement('div');
    cmpWrap.id = 'week-comparison-chart-wrap';
    cmpWrap.style.cssText = 'background:#fff;border-bottom:1px solid #e8e8e8;padding:8px 14px;display:flex;flex-direction:column;gap:6px';
    tblWrap.parentElement.insertBefore(cmpWrap, tblWrap);
  }
  cmpWrap.style.display = 'block';
  cmpWrap.innerHTML = '';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
  header.innerHTML = `
    <span style="font-size:12px;font-weight:700;color:#0070c0">Daily breakdown comparison:</span>
    ${expanded.map(w => `<span style="font-size:11px;background:#ddeeff;color:#0070c0;padding:1px 8px;border-radius:10px;font-weight:600">W${w}</span>`).join(' vs ')}
    <button onclick="collapseAllWeeks()" style="margin-left:auto;padding:2px 8px;font-size:10px;border:1px solid #ddd;border-radius:3px;background:#fff;cursor:pointer">Collapse all</button>
  `;
  cmpWrap.appendChild(header);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'height:160px;width:100%';
  cmpWrap.appendChild(canvas);

  // Collect data for all expanded weeks from the mini charts
  const COLORS = ['#0070c0','#e65100','#107c10','#5b21b6','#dc2626'];
  const WD_NAMES_SHORT = {1:'Sun',2:'Mon',3:'Tue',4:'Wed',5:'Thu',6:'Fri',7:'Sat'};
  const labels = [1,2,3,4,5,6,7].map(w => WD_NAMES_SHORT[w]);

  // gather from tableRows
  const datasets = expanded.map((wk, i) => {
    const row = tableRows.find(r => r.week === wk);
    const weekTotal = row ? row.value : 0;
    // we stored the fetched data in a global cache
    const cached = window._dailyDataCache && window._dailyDataCache[wk];
    if (!cached) return null;
    return {
      label: `W${wk}`,
      data: cached.map(d => d.pct),
      borderColor: COLORS[i % COLORS.length],
      borderWidth: 2, borderDash: i > 0 ? [5,3] : [],
      pointRadius: 4, tension: 0.3, fill: false,
    };
  }).filter(Boolean);

  if (window._weekComparisonChart) window._weekComparisonChart.destroy();
  window._weekComparisonChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { font:{size:10}, boxWidth:16 } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } }
      },
      scales: {
        x: { ticks:{font:{size:11}} },
        y: { min:0, ticks:{font:{size:11}, callback:v=>v.toFixed(0)+'%'},
             title:{display:true,text:'% of Week',font:{size:10}} }
      }
    }
  });
}

function collapseAllWeeks() {
  [...expandedWeeks].forEach(wk => {
    const row = document.getElementById(`daily-row-${wk}`);
    if (row) row.remove();
    const btn = document.querySelector(`[data-wk="${wk}"]`);
    if (btn) btn.textContent = '>';
  });
  expandedWeeks.clear();
  const cmp = document.getElementById('week-comparison-chart-wrap');
  if (cmp) cmp.remove();
  if (window._weekComparisonChart) { window._weekComparisonChart.destroy(); window._weekComparisonChart = null; }
}

function applyDayOp(originalDays, tbody, weekRow) {
  // Collect selected day inputs (those with a non-empty value)
  const inputs = [...tbody.querySelectorAll('.day-op-val')];
  const selected = inputs.filter(inp => inp.value !== '' && !isNaN(parseFloat(inp.value)));
  if (!selected.length) return;

  const pctIncrease = parseFloat(selected[0].value) / 100; // apply same % to all selected
  const weekTotal = weekRow.value;

  // Current % allocations per day
  const dayPcts = {};
  originalDays.forEach(d => dayPcts[d.day] = d.pct / 100);

  // Sum of selected days' current % shares (for ratio-based split)
  const selectedDayNames = new Set(selected.map(inp => inp.dataset.day));
  const selectedTotalPct = originalDays
    .filter(d => selectedDayNames.has(d.day))
    .reduce((s, d) => s + d.pct / 100, 0);

  // Each selected day gets increased proportionally
  const newPcts = {...dayPcts};
  selected.forEach(inp => {
    const dayName = inp.dataset.day;
    const shareFraction = (dayPcts[dayName] || 0) / (selectedTotalPct || 1);
    newPcts[dayName] = dayPcts[dayName] * (1 + pctIncrease * shareFraction);
  });

  // Renormalise so all days sum to 1
  const total = Object.values(newPcts).reduce((a,b) => a+b, 0);
  Object.keys(newPcts).forEach(k => newPcts[k] = newPcts[k] / total);

  // Update table display
  const rows = [...tbody.querySelectorAll('tr')];
  rows.forEach((tr, i) => {
    const day = originalDays[i];
    if (!day) return;
    const newPct = newPcts[day.day] * 100;
    const newVol = weekTotal * newPcts[day.day];
    tr.querySelector('.day-pct').textContent = newPct.toFixed(1) + '%';
    tr.querySelector('.day-vol').textContent = Math.round(newVol).toLocaleString();
    // update data attrs for further ops
    const inp = tr.querySelector('.day-op-val');
    inp.dataset.pct = newPct;
    inp.dataset.vol = newVol;
    inp.value = '';
  });
}

// ===== CELL SELECTION =====
let selectedWeeks = new Set();
function setSelected(td,setAnchor){td.classList.add('selected');selectedCells.add(td);if(setAnchor){if(anchorCell)anchorCell.classList.remove('anchor');anchorCell=td;td.classList.add('anchor');}updateRef();}
function clearSel(){selectedCells.forEach(c=>c.classList.remove('selected','anchor'));selectedCells.clear();selectedWeeks.clear();anchorCell=null;updateRef();}
function selectAllCells(){clearSel();document.querySelectorAll('#tb td.cell').forEach(td=>{td.classList.add('selected');selectedCells.add(td);selectedWeeks.add(+td.dataset.week);});updateRef();}
function selectValueCol(){clearSel();document.querySelectorAll('#tb td[data-col="value"]').forEach(td=>{td.classList.add('selected');selectedCells.add(td);selectedWeeks.add(+td.dataset.week);if(!anchorCell){anchorCell=td;td.classList.add('anchor');}});updateRef();}
function updateRef(){
  const el=document.getElementById('cell-ref');
  if(!selectedCells.size){el.textContent='No selection';renderSelectionKPIs();return;}
  if(selectedCells.size===1){const td=[...selectedCells][0];el.textContent='W'+td.dataset.week+' · '+td.dataset.col;}
  else el.textContent=selectedCells.size+' cells ('+selectedWeeks.size+' wks)';
  renderSelectionKPIs();
}

function renderSelectionKPIs() {
  const bar = document.getElementById('kpi-sel-bar');
  if (!bar) return;
  if (!selectedWeeks.size) { bar.style.display='none'; return; }

  const selRows = tableRows.filter(r => selectedWeeks.has(r.week));
  const wkNums  = [...selectedWeeks].sort((a,b)=>a-b);
  const label   = wkNums.length <= 6
    ? 'W' + wkNums.join(', W')
    : 'W' + wkNums[0] + '..W' + wkNums[wkNums.length-1] + ' (' + wkNums.length + ')';

  const validFc  = selRows.filter(r => r.yoy_fc  !== null);
  const validAct = selRows.filter(r => r.yoy_act !== null);
  const avgFc    = validFc.length  ? validFc.reduce((s,r)=>s+r.yoy_fc,0)/validFc.length   : null;
  const avgAct   = validAct.length ? validAct.reduce((s,r)=>s+r.yoy_act,0)/validAct.length : null;
  const total    = selRows.reduce((s,r)=>s+r.value,0);

  function fmt(v) {
    if (v===null) return '-';
    const s = v>=0?'+':''; const cls = v>=0?'green':'red';
    return `<span class="${cls}">${s}${v.toFixed(1)}%</span>`;
  }

  document.getElementById('ksel-wk-val').innerHTML  = `<span style="font-size:11px;color:#0070c0">${label}</span>`;
  document.getElementById('ksel-fc-val').innerHTML  = fmt(avgFc);
  document.getElementById('ksel-act-val').innerHTML = fmt(avgAct);
  document.getElementById('ksel-tot-val').innerHTML = Math.round(total).toLocaleString();
  bar.style.display = 'flex';
}
// re-apply selection highlighting after a table re-render (by week number)
function reapplySelection(){
  selectedCells.clear();
  if (!selectedWeeks.size) { anchorCell=null; return; }
  document.querySelectorAll('#tb td.cell').forEach(td=>{
    const wk = +td.dataset.week;
    if (selectedWeeks.has(wk)) {
      td.classList.add('selected');
      selectedCells.add(td);
      if (td.dataset.col === 'value' && !anchorCell) { anchorCell = td; td.classList.add('anchor'); }
    }
  });
}
document.addEventListener('mouseup',()=>{isDragging=false;});

// ===== INLINE EDIT =====
function inlineEdit(td,row){
  clearSel();
  const cur = row.value;
  const inp=document.createElement('input');
  inp.className='ov';inp.type='number';inp.value=Math.round(cur);
  td.innerHTML='';td.appendChild(inp);inp.focus();inp.select();
  inp.addEventListener('input',()=>{
    const v=parseFloat(inp.value);
    if(!isNaN(v)){ applyValueChange(row, v); }
  });
  const commit=()=>{
    const v=parseFloat(inp.value);
    if(!isNaN(v)){ applyValueChange(row, v); }
    runChart();
  };
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter')commit();
    if(e.key==='Escape'){ clearOverrideForWeek(row.week); runChart(); }
  });
  inp.addEventListener('blur',commit);
}

// ===== UNIFIED VALUE WRITE-BACK =====
// ratio-split math lives in ratio_split.js (computeOverrides)
function applyValueChange(row, newValue, fromOriginal){
  const wk = String(row.week);
  const { overrideA, overrideB } = computeOverrides(row, newValue, currentMetric, !!fromOriginal);
  if (overrideA !== undefined) overridesA[wk] = overrideA;
  if (overrideB !== undefined) overridesB[wk] = overrideB;

  // Update local row immediately for instant feedback before refetch
  row.value = newValue;
  row.modified = true;
  if (row.base) row.yoy_fc = +((newValue / row.base - 1) * 100).toFixed(1);
}

function clearOverrideForWeek(wk){
  const stack = weekValueStack[wk] || [];
  const prev = stack.pop();
  if(stack.length === 0) delete weekValueStack[wk];
  const w = String(wk);
  if(prev !== undefined){
    const row = tableRows.find(r => r.week === wk && r.row_type === 'forecast');
    if(row) applyValueChange(row, prev, false);
  } else {
    if (currentMetric === COMPONENT_A) delete overridesA[w];
    else if (currentMetric === COMPONENT_B) delete overridesB[w];
    else if (currentMetric === TOTAL_METRIC) { delete overridesA[w]; delete overridesB[w]; }
  }
}

// ===== APPLY OP =====
function applyOp(){
  const op=document.getElementById('opSel').value;
  const val=parseFloat(document.getElementById('opVal').value);
  if(isNaN(val)) return;
  const weeks=new Set([...selectedCells].map(td=>+td.dataset.week).filter(Boolean));
  if(!weeks.size) return;

  // snapshot overrides BEFORE this change for the changelog
  const snapA = {...overridesA};
  const snapB = {...overridesB};

  tableRows.forEach(row=>{
    if(!weeks.has(row.week) || row.row_type!=='forecast') return;
    const cur = op === '=' ? val : row.value;
    let nv;
    if(op==='+')nv=cur+val;else if(op==='-')nv=cur-val;
    else if(op==='*')nv=cur*val;else if(op==='/')nv=val?cur/val:cur;
    else if(op==='%+')nv=cur*(1+val/100);else if(op==='%-')nv=cur*(1-val/100);
    else if(op==='=')nv=val;
    const rounded = Math.round(nv*10)/10;

    // push to per-week stack before applying (so revert can pop back)
    if(!weekValueStack[row.week]) weekValueStack[row.week]=[];
    weekValueStack[row.week].push(row.value);

    applyValueChange(row, rounded, false);

    // record changelog entry
    const opLabel = {'+':'Add','-':'Subtract','*':'Multiply','/':'Divide','%+':'% Increase','%-':'% Decrease','=':'Set to'}[op]||op;
    changeLog.push({
      id: ++changeLogCounter,
      week: row.week,
      op: opLabel,
      val,
      before: row.value, // already updated by applyValueChange but we captured cur
      after: rounded,
      overridesA: {...overridesA},
      overridesB: {...overridesB},
      ts: new Date().toLocaleTimeString(),
    });
  });

  renderChangeLog();
  renderTable();redrawForecast();renderKPIs(+document.getElementById('baseYearSel').value);
  runChart();
}

function revertSelected(){
  selectedWeeks.forEach(wk=>clearOverrideForWeek(wk));
  renderChangeLog();
  clearSel();
  runChart();
}
function revertAll(){
  overridesA={}; overridesB={};
  weekValueStack={};
  changeLog=[];
  renderChangeLog();
  runChart();
}

// ===== SORT =====
function sortBy(col){
  if(sortCol===col)sortDir*=-1;else{sortCol=col;sortDir=1;}
  ['week','base','act2026','value','yoy_act','yoy_fc'].forEach(c=>{
    const th=document.getElementById('th-'+c);if(th)th.className=c===col?'sorted':'';
  });
  renderTable();
}

// ===== EXPORT =====
async function doExport(){
  if(!chartData)return;
  const res=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({metric:currentMetric,chart_data:chartData,table_rows:tableRows})});
  const blob=await res.blob();
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='forecast_'+(metricLabels[currentMetric]||currentMetric).replace(/\s+/g,'_')+'.csv';
  a.click();
}

function downloadChart(){
  if(!chart)return;
  const a=document.createElement('a');
  a.href=chart.toBase64Image('image/png',1.0);
  a.download='forecast_chart.png';a.click();
}

// ===== RESET =====
function resetAll(){
  overridesA={};overridesB={};tableRows=[];chartData=null;clearSel();
  if(chart){chart.destroy();chart=null;}
  document.getElementById('tb').innerHTML='<tr><td colspan="7" style="color:#bbb;padding:20px;text-align:center">Reset.</td></tr>';
  document.getElementById('ttl').textContent='';
  document.getElementById('kpi-bar').innerHTML='';
  document.getElementById('exportBtn').disabled=true;
  document.getElementById('prophetStatus').textContent='';
  setStat('Ready.');
}

function setStat(msg){document.getElementById('stat').textContent=msg;}

// ===== DIVIDER =====
let divDrag=false;
document.getElementById('divider').addEventListener('mousedown',()=>{divDrag=true;document.body.style.cursor='row-resize';});
document.addEventListener('mouseup',()=>{divDrag=false;document.body.style.cursor='';});
document.addEventListener('mousemove',e=>{
  if(!divDrag)return;
  const rect=document.getElementById('main').getBoundingClientRect();
  const h=e.clientY-rect.top-42;
  if(h<160||h>window.innerHeight*.75)return;
  document.getElementById('chart-wrap').style.height=h+'px';
  if(chart)chart.resize();
});

// ===== CHANGE LOG =====
function renderChangeLog() {
  const panel = document.getElementById('changeLogPanel');
  if (!panel) return;
  if (changeLog.length === 0) {
    panel.innerHTML = '<div style="color:#aaa;font-size:11px;padding:6px 8px">No changes yet</div>';
    return;
  }
  // Show most recent first
  const rows = [...changeLog].reverse().map(e => {
    const valFmt = e.op === '% Increase' || e.op === '% Decrease'
      ? `${e.val}%` : e.val.toLocaleString();
    return `<div class="cl-row">
      <div class="cl-week">W${e.week}</div>
      <div class="cl-desc">${e.op} ${valFmt}</div>
      <div class="cl-arrow">→ ${Math.round(e.after).toLocaleString()}</div>
      <div class="cl-time">${e.ts}</div>
    </div>`;
  }).join('');
  panel.innerHTML = rows;
}

// ===== KEYBOARD =====
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='a'){e.preventDefault();selectValueCol();}
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();applyOp();}
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='Y'){e.preventDefault();renderSelectionKPIs();}
  if(e.key==='Escape')clearSel();
  if(e.key==='Delete'&&selectedCells.size)revertSelected();
});
