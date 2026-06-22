// ── Socket connection & connection status ────────────────────
// Establishes the Socket.IO connection and handles connection
// status UI (the "Live/Offline" badge and the reconnect bar).
// Game-specific socket events are wired up in game.js / lobby.js
// / placement.js, which all share this same `socket` instance.

const socket = io({
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  transports: ["websocket", "polling"],
});

function setConn(ok) {
  const badge = document.getElementById("conn-badge");
  badge.className = "conn-badge " + (ok ? "online" : "offline");
  document.getElementById("conn-text").textContent = ok ? "Live" : "Offline";
}

socket.on("connect", () => {
  state.sid = socket.id;
  setConn(true);
  if (state.reconnecting) {
    state.reconnecting = false;
    document.getElementById("reconnect-bar").classList.remove("show");
  }
});

socket.on("disconnect", () => {
  setConn(false);
  if (!document.getElementById("lobby").classList.contains("active")) {
    state.reconnecting = true;
    document.getElementById("reconnect-bar").classList.add("show");
    document.getElementById("reconnect-msg").textContent = "Connection lost — reconnecting…";
  }
});

socket.on("reconnect_attempt", (n) => {
  document.getElementById("reconnect-msg").textContent = `Reconnecting… (attempt ${n})`;
});

socket.on("reconnect", () => {
  setConn(true);
  state.reconnecting = false;
  document.getElementById("reconnect-bar").classList.remove("show");
});

socket.on("reconnect_failed", () => {
  document.getElementById("reconnect-msg").textContent = "Could not reconnect — please refresh.";
});

socket.on("room_closed", () => {
  if (!document.getElementById("ov-gameover").classList.contains("show")) {
    document.getElementById("ov-left").classList.add("show");
  }
});

// ── Driver Rankings (leaderboard) ────────────────────────────
// Rows are aggregated server-side by player name, so a player who
// plays multiple matches under the same callsign appears once with
// combined wins/losses/accuracy.
socket.on("leaderboard_update", (rows) => {
  const el = document.getElementById("lb-list");
  if (!rows.length) {
    el.innerHTML = '<div class="lb-empty">No drivers ranked yet.<br>Complete a game to appear.</div>';
    return;
  }
  el.innerHTML = rows.map((r, i) => {
    const acc = r.shots > 0 ? Math.round((r.hits / r.shots) * 100) : 0;
    const rankClass = i === 0 ? "g" : i === 1 ? "s" : i === 2 ? "b" : "";
    const medal = i === 0 ? "1" : i === 1 ? "2" : i === 2 ? "3" : (i + 1);
    return `<div class="lb-row"><div class="lb-rank ${rankClass}">${medal}</div><div class="lb-av">${esc(r.name.slice(0, 2).toUpperCase())}</div><div class="lb-info"><div class="lb-name">${esc(r.name)}</div><div class="lb-sub">${acc}% acc · ${r.losses}L</div></div><div><div class="lb-wins">${r.wins}</div><div class="lb-wlabel">wins</div></div></div>`;
  }).join("");
});
