// ── Grid rendering ────────────────────────────────────────────
// Builds the NxN board markup (column header, row labels, and
// N*N cells each labelled with an airport code), where N is
// state.boardDim (8, 9, or 10). `afterBuild` lets callers attach
// per-cell behaviour (click handlers, classes, etc.) without this
// module knowing about placement/game-specific logic.

function makeGrid(wrapperId, afterBuild) {
  const dim = state.boardDim || DEFAULT_BOARD_DIM;
  const size = dim * dim;
  const cols = COLS.slice(0, dim);

  const wrap = document.getElementById(wrapperId);
  wrap.innerHTML = "";

  const gridWrap = document.createElement("div");
  gridWrap.className = "grid-wrap";

  const colRow = document.createElement("div");
  colRow.className = "gcol-labels";
  cols.split("").forEach((c) => {
    const d = document.createElement("div");
    d.className = "gcol-label";
    d.textContent = c;
    colRow.appendChild(d);
  });
  gridWrap.appendChild(colRow);

  const body = document.createElement("div");
  body.className = "gbody";

  const rowLabels = document.createElement("div");
  rowLabels.className = "grow-labels";
  for (let r = 1; r <= dim; r++) {
    const d = document.createElement("div");
    d.className = "grow-label";
    d.textContent = r;
    rowLabels.appendChild(d);
  }

  const grid = document.createElement("div");
  grid.className = "grid";
  document.documentElement.style.setProperty("--grid-dim", dim);
  for (let i = 0; i < size; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.i = i;
    const label = document.createElement("span");
    label.className = "cell-label";
    label.textContent = CITIES[i] || "";
    cell.appendChild(label);
    grid.appendChild(cell);
  }

  body.appendChild(rowLabels);
  body.appendChild(grid);
  gridWrap.appendChild(body);
  wrap.appendChild(gridWrap);

  for (let i = 0; i < size; i++) afterBuild(i);
}
