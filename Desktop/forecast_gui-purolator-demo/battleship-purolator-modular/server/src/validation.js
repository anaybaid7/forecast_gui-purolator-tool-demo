// ── Input validation ─────────────────────────────────────────
// Small, pure helpers for sanitizing data coming from clients.
// Keeping these separate makes it easy to unit test the rules
// without spinning up sockets, and keeps the socket handlers
// focused on orchestration rather than validation logic.

const { MAX_NAME_LENGTH, BOARD_SIZE, MIN_BOARD_DIM, MAX_BOARD_DIM, DEFAULT_BOARD_DIM } = require("./constants");

/** Trim, cap length, and reject empty/non-string names. Returns null if invalid. */
function sanitizeName(rawName) {
  if (!rawName || typeof rawName !== "string") return null;
  const name = rawName.slice(0, MAX_NAME_LENGTH).trim();
  return name || null;
}

/** Normalize a room code: uppercase + trimmed. */
function sanitizeRoomId(rawRoomId) {
  if (!rawRoomId || typeof rawRoomId !== "string") return null;
  const id = rawRoomId.toUpperCase().trim();
  return id || null;
}

/** Clamp a requested board dimension to the supported range, defaulting if invalid. */
function sanitizeBoardDim(rawDim) {
  const dim = Number(rawDim);
  if (!Number.isInteger(dim)) return DEFAULT_BOARD_DIM;
  if (dim < MIN_BOARD_DIM) return MIN_BOARD_DIM;
  if (dim > MAX_BOARD_DIM) return MAX_BOARD_DIM;
  return dim;
}

/**
 * Validate a ship-placement payload against the expected ship list
 * and the room's board size (defaults to the classic 10x10/100-cell board).
 */
function isValidPlacement(placedShips, expectedShips, boardSize = BOARD_SIZE) {
  if (!Array.isArray(placedShips) || placedShips.length !== expectedShips.length) {
    return false;
  }

  const allCells = placedShips.flatMap((s) => s.cells || []);
  const inBounds = allCells.every(
    (c) => typeof c === "number" && c >= 0 && c < boardSize
  );
  if (!inBounds) return false;

  const noOverlap = new Set(allCells).size === allCells.length;
  return noOverlap;
}

/** Validate a fire target index against the room's board size. */
function isValidShotIndex(index, boardSize = BOARD_SIZE) {
  return typeof index === "number" && index >= 0 && index < boardSize;
}

module.exports = {
  sanitizeName,
  sanitizeRoomId,
  sanitizeBoardDim,
  isValidPlacement,
  isValidShotIndex,
};
