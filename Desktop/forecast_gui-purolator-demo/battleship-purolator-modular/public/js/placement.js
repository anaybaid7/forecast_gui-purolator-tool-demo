// ── Fleet placement screen ───────────────────────────────────
// Lets the player drag/click ships onto their board before battle.
// Supports a configurable square board (8x8 to 10x10, chosen by
// the room creator) — `state.boardDim` controls row width for
// orientation/bounds checks, and the grid is rebuilt at that size.

function previewCells(idx, ship, orientation) {
  const dim = state.boardDim;
  const r = Math.floor(idx / dim);
  const c = idx % dim;
  const cells = [];
  for (let i = 0; i < ship.size; i++) {
    if (orientation === "H") {
      if (c + i >= dim) return null;
      cells.push(r * dim + c + i);
    } else {
      if (r + i >= dim) return null;
      cells.push((r + i) * dim + c);
    }
  }
  return cells;
}

function isValid(cells) {
  return cells && cells.every((c) => !state.myBoard[c]);
}

function selectShip(idx) {
  if (state.placed.find((p) => p.name === state.ships[idx]?.name)) return;
  state.selShip = idx;
  document.querySelectorAll(".ship-card").forEach((el, i) => el.classList.toggle("selected", i === idx));
}

function toggleOrientation() {
  state.orient = state.orient === "H" ? "V" : "H";
  document.getElementById("orient-label").textContent = state.orient === "H" ? "Horizontal" : "Vertical";
  clearPreview();
}

function previewAt(idx) {
  if (state.selShip === null) return;
  clearPreview();
  const cells = previewCells(idx, state.ships[state.selShip], state.orient);
  const ok = isValid(cells);
  (cells || []).forEach((c) => {
    const cell = qs(`#place-grid-wrap .cell[data-i="${c}"]`);
    if (cell && !cell.classList.contains("has-ship")) cell.classList.add(ok ? "preview-ok" : "preview-bad");
  });
}

function clearPreview() {
  document.querySelectorAll("#place-grid-wrap .preview-ok, #place-grid-wrap .preview-bad")
    .forEach((c) => c.classList.remove("preview-ok", "preview-bad"));
}

function placeAt(idx) {
  if (state.selShip === null) return;
  const ship = state.ships[state.selShip];
  const cells = previewCells(idx, ship, state.orient);
  if (!isValid(cells)) return;

  cells.forEach((c) => { state.myBoard[c] = "ship"; });
  state.placed.push({ name: ship.name, cells });
  cells.forEach((c) => {
    const cell = qs(`#place-grid-wrap .cell[data-i="${c}"]`);
    if (cell) {
      cell.classList.remove("preview-ok", "preview-bad", "placeable");
      cell.classList.add("has-ship");
    }
  });
  qs(`.ship-card[data-idx="${state.selShip}"]`)?.classList.add("placed");

  state.selShip = null;
  document.querySelectorAll(".ship-card").forEach((el) => el.classList.remove("selected"));

  if (state.placed.length === state.ships.length) {
    document.getElementById("confirm-btn").disabled = false;
    toast("All vehicles placed! Lock in your routes.", "info", 3000);
  }
}

function confirmPlacement() {
  if (state.placed.length < state.ships.length) return;
  socket.emit("place_ships", { ships: state.placed });
  document.getElementById("confirm-btn").disabled = true;
}

/** Clear all placed ships and rebuild the board at the current size. Used by the resize control. */
function clearPlacement() {
  state.placed = [];
  state.myBoard = Array(state.boardDim * state.boardDim).fill(null);
  state.selShip = null;
  document.getElementById("confirm-btn").disabled = true;
  document.querySelectorAll(".ship-card").forEach((el) => el.classList.remove("placed", "selected"));
  buildPlacementGrid();
}

/** (Re)build just the placement grid at state.boardDim, without resetting placed ships. */
function buildPlacementGrid() {
  makeGrid("place-grid-wrap", (idx) => {
    const cell = qs(`#place-grid-wrap .cell[data-i="${idx}"]`);
    if (!cell) return;
    if (state.myBoard[idx] === "ship") {
      cell.classList.add("has-ship");
    } else {
      cell.classList.add("placeable");
    }
    cell.addEventListener("mouseover", () => previewAt(idx));
    cell.addEventListener("mouseout", clearPreview);
    cell.addEventListener("click", () => placeAt(idx));
  });
}

/**
 * Propose a new board size for this match (any value within the allowed
 * range). Doesn't take effect immediately — the opponent sees an accept/
 * decline prompt, and the resize only happens once they accept. Only
 * meaningful before placement is confirmed.
 */
function applyBoardDim() {
  const input = document.getElementById("board-size-input");
  let dim = Math.round(Number(input.value));

  if (!Number.isFinite(dim)) dim = state.boardDim;
  if (dim < MIN_BOARD_DIM) dim = MIN_BOARD_DIM;
  if (dim > MAX_BOARD_DIM) dim = MAX_BOARD_DIM;

  input.value = dim;
  if (dim === state.boardDim) return;
  socket.emit("set_board_dim", { boardDim: dim });
}

function setBoardSizeStatus(text, color) {
  const el = document.getElementById("board-size-status");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = color || "";
}

function setBoardSizeControlsEnabled(enabled) {
  document.getElementById("board-size-input")?.toggleAttribute("disabled", !enabled);
  document.getElementById("board-size-apply")?.toggleAttribute("disabled", !enabled);
}

// The proposer sees a "waiting" state until the other player responds.
socket.on("board_dim_proposal_sent", ({ boardDim }) => {
  setBoardSizeStatus(`Waiting for ${state.oppName} to confirm ${boardDim}×${boardDim}…`, "var(--ink-3)");
  setBoardSizeControlsEnabled(false);
});

// The other player sees the proposal with accept/decline buttons.
socket.on("board_dim_proposed", ({ boardDim, proposedByName }) => {
  const el = document.getElementById("board-size-status");
  if (!el) return;
  el.innerHTML = `${esc(proposedByName)} wants to play on <strong>${boardDim}×${boardDim}</strong>. ` +
    `<button class="btn btn-red" style="width:auto;height:26px;font-size:11px;padding:0 10px;display:inline-flex;margin-left:6px;" onclick="respondToBoardDim(true)">Accept</button> ` +
    `<button class="btn btn-outline" style="width:auto;height:26px;font-size:11px;padding:0 10px;display:inline-flex;margin-left:4px;" onclick="respondToBoardDim(false)">Decline</button>`;
  el.style.color = "var(--ink-2)";
  setBoardSizeControlsEnabled(false);
});

function respondToBoardDim(accept) {
  socket.emit("board_dim_response", { accept });
  setBoardSizeStatus(accept ? "Applying…" : "Declining…", "var(--ink-3)");
}

// Accepted: both boards resize and reset.
socket.on("board_resized", ({ boardDim, confirmedByName }) => {
  state.boardDim = boardDim;
  const input = document.getElementById("board-size-input");
  if (input) input.value = boardDim;
  clearPlacement();
  setBoardSizeControlsEnabled(true);
  setBoardSizeStatus("", "");
  toast(`Board resized to ${boardDim}×${boardDim} — confirmed by ${confirmedByName}`, "info", 2600);
});

// Declined: nothing changes, both players are told.
socket.on("board_dim_declined", ({ boardDim, declinedByName }) => {
  const input = document.getElementById("board-size-input");
  if (input) input.value = boardDim;
  setBoardSizeControlsEnabled(true);
  setBoardSizeStatus("", "");
  toast(`${declinedByName} kept the board at ${boardDim}×${boardDim}`, "info", 2600);
});

function buildPlacement() {
  document.getElementById("place-name").textContent = state.myName;
  document.getElementById("place-msg").textContent = "";
  document.getElementById("place-msg").style.color = "";
  document.getElementById("confirm-btn").disabled = true;
  state.orient = "H";
  document.getElementById("orient-label").textContent = "Horizontal";

  const list = document.getElementById("ship-list");
  list.innerHTML = "";
  state.ships.forEach((ship, i) => {
    const div = document.createElement("div");
    div.className = "ship-card";
    div.dataset.idx = i;
    div.innerHTML = `<div class="ship-card-top"><span class="ship-icon">${ship.icon || "📦"}</span><span class="ship-name">${ship.name}</span><span class="ship-sz">${ship.size}</span></div><div class="ship-dots">${Array(ship.size).fill('<div class="ship-dot"></div>').join("")}</div><span class="placed-check">✓</span>`;
    div.onclick = () => selectShip(i);
    list.appendChild(div);
  });

  const input = document.getElementById("board-size-input");
  if (input) input.value = state.boardDim;
  setBoardSizeControlsEnabled(true);
  setBoardSizeStatus("", "");

  state.myBoard = Array(state.boardDim * state.boardDim).fill(null);
  buildPlacementGrid();
}

document.addEventListener("keydown", (e) => {
  if ((e.key === "r" || e.key === "R") && document.getElementById("placement").classList.contains("active")) {
    toggleOrientation();
  }
});

socket.on("placement_confirmed", () => {
  const el = document.getElementById("place-msg");
  el.textContent = "✓ Locked in! Waiting for rival…";
  el.style.color = "var(--green)";
});
