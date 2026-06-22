// Verify the minimum board size (6x6 = 36 cells) can still legally fit
// all 5 ships (sizes 5,4,3,3,2 = 17 cells total) without overlap.
const { SHIPS, TOTAL_SHIP_CELLS, MIN_BOARD_DIM, MAX_BOARD_DIM } = require("../server/src/constants");
const { isValidPlacement, sanitizeBoardDim } = require("../server/src/validation");

console.log("MIN_BOARD_DIM:", MIN_BOARD_DIM, "MAX_BOARD_DIM:", MAX_BOARD_DIM);
console.log("TOTAL_SHIP_CELLS:", TOTAL_SHIP_CELLS, "largest ship:", Math.max(...SHIPS.map(s=>s.size)));

const dim = MIN_BOARD_DIM; // 6
const boardSize = dim * dim; // 36

// Hand-pack ships into a 6x6 grid (rows of 6 cells: 0-5, 6-11, 12-17, 18-23, 24-29, 30-35)
// Air Freighter (5): row0 cols0-4 -> 0,1,2,3,4
// Semi Truck (4):    row1 cols0-3 -> 6,7,8,9
// Delivery Van (3):  row2 cols0-2 -> 12,13,14
// Cargo Bike (3):    row3 cols0-2 -> 18,19,20
// Scooter (2):       row4 cols0-1 -> 24,25
const placed = [
  { name: SHIPS[0].name, cells: [0,1,2,3,4] },
  { name: SHIPS[1].name, cells: [6,7,8,9] },
  { name: SHIPS[2].name, cells: [12,13,14] },
  { name: SHIPS[3].name, cells: [18,19,20] },
  { name: SHIPS[4].name, cells: [24,25] },
];

const valid = isValidPlacement(placed, SHIPS, boardSize);
console.log("6x6 placement valid:", valid, "(expect true)");

// Sanity: dim below MIN clamps up, dim above MAX clamps down
console.log("sanitizeBoardDim(4):", sanitizeBoardDim(4), "(expect", MIN_BOARD_DIM, ")");
console.log("sanitizeBoardDim(20):", sanitizeBoardDim(20), "(expect", MAX_BOARD_DIM, ")");
console.log("sanitizeBoardDim(12):", sanitizeBoardDim(12), "(expect 12)");

if (valid && sanitizeBoardDim(4) === MIN_BOARD_DIM && sanitizeBoardDim(20) === MAX_BOARD_DIM && sanitizeBoardDim(12) === 12) {
  console.log("\n✅ PASS — min board size fits all ships; clamping works for out-of-range values.");
  process.exit(0);
} else {
  console.log("\n❌ FAIL");
  process.exit(1);
}
