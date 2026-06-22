// ── DOM & formatting helpers ─────────────────────────────────
// Small, dependency-free helpers used throughout the UI layer:
// querying, escaping, toasts, screen switching and the nav bar.

function qs(sel) {
  return document.querySelector(sel);
}

function v(id) {
  return document.getElementById(id).value.trim();
}

function err(id, message) {
  document.getElementById(id).textContent = message;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Show a transient toast notification (respects the "Move Notifications" setting). */
function toast(msg, type = "info", dur = 2800) {
  if (!opts.toasts) return;
  const stack = document.getElementById("toast-stack");
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  stack.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 350);
  }, dur);
}

/** Flash the "X Sunk!" banner at the top of the screen. */
function sunkBanner(name, icon) {
  const el = document.getElementById("sunk-banner");
  el.innerHTML = icon + " " + name + " Sunk!";
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

/** Highlight the active step (0=Lobby, 1=Fleet Setup, 2=Battle) in the header nav. */
function setNav(step) {
  [0, 1, 2].forEach((i) => document.getElementById("nav-" + i).classList.toggle("active", i === step));
}

/** Switch the visible full-page screen and toggle the sidebar FAB accordingly. */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.getElementById("fab").style.display = id === "game" ? "" : "none";
}

/** Apply a result class ("hit"/"miss"/etc.) to a grid cell, preserving its label. */
function applyState(cell, cellState) {
  cell.classList.remove("preview-ok", "preview-bad", "has-ship", "placeable", "fresh");
  const label = cell.querySelector(".cell-label");
  cell.innerHTML = "";
  if (label) cell.appendChild(label);
  cell.classList.add(cellState);
  if (cellState === "hit" && opts.animations) cell.classList.add("fresh");
}
