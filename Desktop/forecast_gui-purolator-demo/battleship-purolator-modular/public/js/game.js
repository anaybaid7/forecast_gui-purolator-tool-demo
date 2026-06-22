// ── Battle screen ─────────────────────────────────────────────
// Handles the live game: building the two boards, firing, applying
// shot results, fleet health bars, the package-tracking sidebar,
// game-over overlay and rematch flow. All board math respects
// state.boardDim so 8x8/9x9/10x10 matches behave the same way.

function buildHealth(id) {
  const el = document.getElementById(id);
  el.innerHTML = state.ships.map((s) =>
    `<div class="ship-health-row"><span class="sh-icon">${s.icon || "📦"}</span><div class="sh-bar"><div class="sh-fill" id="${id}-f-${s.name.replace(/\s/g, "_")}" style="width:100%"></div></div><span class="sh-name">${s.name}</span></div>`
  ).join("");
  if (!opts.healthBars) el.style.display = "none";
}

function updateHealth(id, name, hitCount, total, sunk) {
  const fill = document.getElementById(`${id}-f-${name.replace(/\s/g, "_")}`);
  if (!fill) return;
  fill.style.width = Math.max(0, ((total - hitCount) / total) * 100) + "%";
  if (sunk) fill.classList.add("sunk");
}

function updateMyFleet() {
  state.placed.forEach((ship) => {
    const sunk = ship.cells.every((c) => state.myBoard[c] === "hit");
    const hitCt = ship.cells.filter((c) => state.myBoard[c] === "hit").length;
    updateHealth("my-health", ship.name, hitCt, ship.cells.length, sunk);
    if (sunk && !state.myShipSunk[ship.name]) {
      state.myShipSunk[ship.name] = true;
      const def = state.ships.find((s) => s.name === ship.name);
      sunkBanner(ship.name, def?.icon || "💀");
    }
  });
  const sunkCount = state.placed.filter((s) => s.cells.every((c) => state.myBoard[c] === "hit")).length;
  document.getElementById("my-status").textContent = sunkCount === 0 ? "Intact" : `${sunkCount}/${state.placed.length} sunk`;
}

/** Count distinct enemy ships sunk by flood-filling contiguous "hit" cells on the enemy board. */
function countEnemySunk() {
  const dim = state.boardDim;
  const visited = new Set();
  let groups = 0;
  for (let i = 0; i < dim * dim; i++) {
    if (state.enemyBoard[i] !== "hit" || visited.has(i)) continue;
    const stack = [i];
    while (stack.length) {
      const c = stack.pop();
      if (visited.has(c)) continue;
      visited.add(c);
      const r = Math.floor(c / dim);
      const col = c % dim;
      [[r - 1, col], [r + 1, col], [r, col - 1], [r, col + 1]].forEach(([nr, nc]) => {
        if (nr >= 0 && nr < dim && nc >= 0 && nc < dim) {
          const ni = nr * dim + nc;
          if (state.enemyBoard[ni] === "hit" && !visited.has(ni)) stack.push(ni);
        }
      });
    }
    groups++;
  }
  return groups;
}

function addTrack(idx, result, who) {
  const code = CITIES[idx] || "---";
  const city = CITY_NAMES[code] || code;
  const el = document.getElementById("track-list");
  const empty = el.querySelector(".lb-empty");
  if (empty) empty.remove();

  state.trackN++;
  document.getElementById("track-badge").textContent = state.trackN;

  const now = new Date();
  const t = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const div = document.createElement("div");
  div.className = "track-item";
  div.innerHTML = `<div class="track-row"><span class="track-pkg">PRL-${String(state.trackN).padStart(4, "0")}</span><span class="track-time">${t}</span></div><div class="track-status ${result}">${result === "hit" ? "● Route Intercepted" : "○ Delivery Clear"}</div><div class="track-loc">${esc(city)} · ${code} · ${esc(who)}</div>`;
  el.insertBefore(div, el.firstChild);
  while (el.children.length > 50) el.removeChild(el.lastChild);
}

function buildGame() {
  document.getElementById("hud-myname").textContent = state.myName;
  document.getElementById("hud-oppname").textContent = state.oppName;
  document.getElementById("my-av").textContent = state.myName.slice(0, 2).toUpperCase();
  document.getElementById("opp-av").textContent = state.oppName.slice(0, 2).toUpperCase();

  refreshHUD();
  buildHealth("my-health");
  buildHealth("enemy-health");

  makeGrid("my-grid-wrap", (idx) => {
    if (state.myBoard[idx] === "ship") {
      const cell = qs(`#my-grid-wrap .cell[data-i="${idx}"]`);
      if (cell) cell.classList.add("has-ship");
    }
  });

  makeGrid("enemy-grid-wrap", (idx) => {
    const cell = qs(`#enemy-grid-wrap .cell[data-i="${idx}"]`);
    if (cell) {
      cell.classList.add("enemy");
      cell.addEventListener("click", () => fireAt(idx));
    }
  });
}

function refreshHUD() {
  document.getElementById("hud-acc").textContent = state.shots > 0 ? Math.round((state.hits / state.shots) * 100) + "%" : "—";
  document.getElementById("hud-shots").textContent = state.shots;
  document.getElementById("hud-sunk").textContent = state.sunkCt;
}

function refreshTurn() {
  const pill = document.getElementById("turn-pill");
  document.getElementById("turn-text").textContent = state.myTurn ? "Your Turn — Fire!" : state.oppName + "'s Turn";
  pill.className = "turn-pill " + (state.myTurn ? "mine" : "theirs");
}

function fireAt(idx) {
  if (!state.myTurn) { toast("Wait for your turn!", "miss", 1500); return; }
  if (state.enemyBoard[idx] === "hit" || state.enemyBoard[idx] === "miss") return;
  socket.emit("fire", { index: idx });
  state.myTurn = false;
  refreshTurn();
}

function requestRematch() {
  socket.emit("request_rematch");
  document.getElementById("ov-note").textContent = "Rematch requested — waiting for rival…";
}

// ── Socket events ─────────────────────────────────────────────

socket.on("both_connected", ({ names, ships, boardDim }) => {
  state.boardDim = boardDim || DEFAULT_BOARD_DIM;
  state.ships = ships;
  state.myName = names[state.pidx] || names[0];
  state.oppName = names[state.pidx === 0 ? 1 : 0] || names[1];
  buildPlacement();
  showScreen("placement");
  setNav(1);
});

socket.on("game_start", ({ turn }) => {
  state.myTurn = turn === state.sid;
  buildGame();
  showScreen("game");
  refreshTurn();
  setNav(2);
  toast(state.myTurn ? "🔥 Your turn, fire first!" : "⏳ " + state.oppName + " fires first", "info", 3500);
});

function cellCoord(index) {
  const dim = state.boardDim;
  return COLS[index % dim] + (Math.floor(index / dim) + 1);
}

socket.on("shot_result", ({ index, result, firedBy, nextTurn }) => {
  const mine = firedBy === state.sid;

  if (mine) {
    state.enemyBoard[index] = result;
    const cell = qs(`#enemy-grid-wrap .cell[data-i="${index}"]`);
    if (cell) {
      cell.classList.remove("enemy");
      applyState(cell, result);
      cell.classList.add("enemy");
      if (opts.animations && result === "miss") cell.classList.add("fresh");
    }
    if (result === "hit") {
      state.hits++;
      state.sunkCt = countEnemySunk();
      document.getElementById("hud-sunk").textContent = state.sunkCt;
      toast("💥 Hit at " + cellCoord(index), "hit");
    } else {
      toast("Miss at " + cellCoord(index), "miss", 2200);
    }
    state.shots++;
    refreshHUD();
  } else {
    state.myBoard[index] = result;
    const cell = qs(`#my-grid-wrap .cell[data-i="${index}"]`);
    if (cell) {
      cell.classList.remove("has-ship");
      applyState(cell, result);
      if (opts.animations) cell.classList.add("fresh");
    }
    updateMyFleet();
    if (result === "hit") toast("💣 " + state.oppName + " hit " + cellCoord(index), "hit", 2200);
    else toast(state.oppName + " missed at " + cellCoord(index), "miss", 1800);
  }

  addTrack(index, result, mine ? state.myName : state.oppName);
  if (nextTurn) {
    state.myTurn = nextTurn === state.sid;
    refreshTurn();
  }
});

socket.on("game_over", ({ winner, winnerName, stats }) => {
  const won = winner === state.sid;
  document.getElementById("ov-icon").className = "ov-icon " + (won ? "win" : "lose");
  document.getElementById("ov-icon").textContent = won ? "🏆" : "💀";
  document.getElementById("ov-title").textContent = won ? "Delivered!" : "Route Failed";
  document.getElementById("ov-title").className = "ov-title " + (won ? "win" : "lose");
  document.getElementById("ov-sub").textContent = won
    ? `You intercepted all of ${state.oppName}'s vehicles.`
    : `${winnerName} destroyed your entire fleet.`;
  document.getElementById("ov-stats").innerHTML = [
    [stats.shots, "Shots"], [stats.accuracy + "%", "Accuracy"], [stats.duration + "s", "Duration"],
  ].map(([val, label]) => `<div class="ov-stat"><div class="ov-stat-val ${won ? "red" : ""}">${val}</div><div class="ov-stat-label">${label}</div></div>`).join("");
  setTimeout(() => document.getElementById("ov-gameover").classList.add("show"), 300);
});

socket.on("rematch_requested", () => {
  document.getElementById("ov-note").textContent = "Rival requested a rematch — click to accept!";
});

socket.on("rematch_start", ({ ships, boardDim }) => {
  resetMatchState(ships, boardDim);
  document.getElementById("track-badge").textContent = "0";
  document.getElementById("track-list").innerHTML = '<div class="lb-empty" style="padding:14px;">No events yet</div>';
  document.getElementById("ov-gameover").classList.remove("show");
  buildPlacement();
  showScreen("placement");
  setNav(1);
});

socket.on("opponent_left", () => document.getElementById("ov-left").classList.add("show"));
