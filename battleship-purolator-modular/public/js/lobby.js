// ── Lobby: create / join room ────────────────────────────────

function createRoom() {
  const name = v("c-name");
  if (!name) { err("c-err", "Enter a callsign"); return; }
  err("c-err", "");
  state.myName = name;
  state.pidx = 0;
  // Board size defaults to 10x10 here; either player can change it on the
  // Fleet Setup screen before placing ships (see placement.js / applyBoardDim).
  socket.emit("create_room", { name });
}

function joinRoom() {
  const name = v("j-name");
  const code = document.getElementById("j-code").value.trim().toUpperCase();
  if (!name) { err("j-err", "Enter a callsign"); return; }
  if (code.length < 4) { err("j-err", "Enter the full room code"); return; }
  err("j-err", "");
  state.myName = name;
  state.pidx = 1;
  socket.emit("join_room", { roomId: code, name });
}

function copyCode() {
  const code = document.getElementById("room-code").textContent;
  const btn = document.getElementById("copy-btn");
  const markCopied = () => {
    btn.textContent = "✓ Copied!";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1800);
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(markCopied).catch(() => fallbackCopy(code, markCopied));
  } else {
    fallbackCopy(code, markCopied);
  }
}

function fallbackCopy(text, onDone) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  onDone();
}

socket.on("room_created", ({ roomId, playerIndex, boardDim }) => {
  state.pidx = playerIndex;
  if (boardDim) state.boardDim = boardDim;
  document.getElementById("room-code").textContent = roomId;
  showScreen("waiting");
});

socket.on("error", (msg) => err("j-err", msg));

document.getElementById("c-name")?.addEventListener("keydown", (e) => e.key === "Enter" && createRoom());
["j-name", "j-code"].forEach((id) => {
  document.getElementById(id)?.addEventListener("keydown", (e) => e.key === "Enter" && joinRoom());
});
document.getElementById("j-code")?.addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase();
});
