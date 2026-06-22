// ── Shared client-side state ─────────────────────────────────
// A single mutable object holding everything about "this match"
// (names, boards, turn, scores). Other modules read and write
// through `state` so there's one source of truth instead of a
// pile of loose globals.
//
// `opts` holds the display preferences from the settings panel
// and is kept separate since it persists across rematches.

const state = {
  sid: "",
  myName: "",
  oppName: "",
  pidx: -1,

  boardDim: DEFAULT_BOARD_DIM,
  ships: [],
  placed: [],
  myBoard: Array(DEFAULT_BOARD_DIM * DEFAULT_BOARD_DIM).fill(null),
  enemyBoard: Array(DEFAULT_BOARD_DIM * DEFAULT_BOARD_DIM).fill(null),

  selShip: null,
  orient: "H",
  myTurn: false,

  shots: 0,
  hits: 0,
  trackN: 0,
  sunkCt: 0,
  reconnecting: false,
  myShipSunk: {},
};

const opts = {
  toasts: true,
  animations: true,
  healthBars: true,
  sidebar: true,
};

/** Reset all per-match fields for a rematch, keeping names/sid/pidx intact. */
function resetMatchState(newShips, boardDim) {
  if (boardDim) state.boardDim = boardDim;
  const size = state.boardDim * state.boardDim;
  state.ships = newShips;
  state.placed = [];
  state.myBoard = Array(size).fill(null);
  state.enemyBoard = Array(size).fill(null);
  state.selShip = null;
  state.orient = "H";
  state.myTurn = false;
  state.shots = 0;
  state.hits = 0;
  state.trackN = 0;
  state.sunkCt = 0;
  state.myShipSunk = {};
}
