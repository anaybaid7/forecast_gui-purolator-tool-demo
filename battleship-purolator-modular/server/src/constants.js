// ── Game constants ───────────────────────────────────────────
// Shared values used across room management, gameplay logic and
// the leaderboard. Keeping these in one place means the front-end
// "ships" payload and the server-side win condition can never drift
// apart.

const SHIPS = [
  { name: "Air Freighter", size: 5, icon: "✈️" },
  { name: "Semi Truck", size: 4, icon: "🚛" },
  { name: "Delivery Van", size: 3, icon: "🚐" },
  { name: "Cargo Bike", size: 3, icon: "🚲" },
  { name: "Scooter", size: 2, icon: "🛵" },
];

const TOTAL_SHIP_CELLS = SHIPS.reduce((sum, ship) => sum + ship.size, 0); // 17

const BOARD_SIZE = 100; // default 10x10 grid (legacy constant, kept for back-compat)
const DEFAULT_BOARD_DIM = 10;
const MIN_BOARD_DIM = 6;  // smallest board that can still fit the 5-cell Air Freighter with room to move
const MAX_BOARD_DIM = 15; // upper bound to keep boards renderable/sane
const MAX_NAME_LENGTH = 20;
const ROOM_ID_LENGTH = 5;
const ROOM_TIMEOUT_MS = 30 * 60 * 1000; // auto-clean rooms after 30 min idle
const DISCONNECT_GRACE_MS = 8 * 1000; // window for reconnect before room teardown
const LEADERBOARD_SIZE = 20;

module.exports = {
  SHIPS,
  TOTAL_SHIP_CELLS,
  BOARD_SIZE,
  DEFAULT_BOARD_DIM,
  MIN_BOARD_DIM,
  MAX_BOARD_DIM,
  MAX_NAME_LENGTH,
  ROOM_ID_LENGTH,
  ROOM_TIMEOUT_MS,
  DISCONNECT_GRACE_MS,
  LEADERBOARD_SIZE,
};
