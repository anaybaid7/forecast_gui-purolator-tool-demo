// ── Display settings panel ───────────────────────────────────
// The gear icon opens a small panel for grid size, font scale,
// and toggles for the sidebar, toasts, hit animations and ship
// health bars. Pure UI state — none of this affects gameplay.

function openSettings() {
  document.getElementById("settings-overlay").classList.add("show");
}

function closeSettings(e) {
  if (e && e.target !== document.getElementById("settings-overlay")) return;
  document.getElementById("settings-overlay").classList.remove("show");
}

function updateCell(value) {
  document.documentElement.style.setProperty("--cell", value + "px");
  document.getElementById("cell-val").textContent = value + "px";
}

function updateFont(value) {
  document.documentElement.style.setProperty("--font-scale", value);
  document.getElementById("font-val").textContent = Math.round(value * 100) + "%";
}

function toggleOpt(key, toggleId) {
  opts[key] = !opts[key];
  document.getElementById(toggleId).classList.toggle("on", opts[key]);
  if (key === "healthBars") {
    document.querySelectorAll(".ship-health").forEach((el) => {
      el.style.display = opts.healthBars ? "" : "none";
    });
  }
}

function toggleSidebar() {
  opts.sidebar = !opts.sidebar;
  document.getElementById("sidebar").classList.toggle("collapsed", !opts.sidebar);
  document.getElementById("tog-sidebar").classList.toggle("on", opts.sidebar);
  document.getElementById("fab").textContent = opts.sidebar ? "📋" : "📊";
}

function toggleSidebarFab() {
  toggleSidebar();
  document.getElementById("settings-overlay").classList.remove("show");
}
