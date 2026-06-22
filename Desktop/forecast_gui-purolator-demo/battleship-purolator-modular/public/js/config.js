// ── Static configuration ─────────────────────────────────────
// Airport codes used to label grid cells (gives every cell a
// "destination"), a lookup for the handful we show full city
// names for in the package tracker, and the column letters used
// for the A-J grid headers.

const CITIES = ["YYZ","YVR","YUL","YYC","YOW","YEG","YHZ","YWG","YQB","YXE","YYT","YYJ","YQR","YXY","YZF","YSB","YXU","YKA","YQT","YPR","YAM","YBR","YDF","YGK","YGL","YHM","YMM","YPQ","YQG","YQL","YQM","YSJ","YSM","YTS","YXH","YXL","YXS","YXZ","YYB","YYD","YYE","YYG","YYQ","YZH","YZP","YZR","YZU","YZV","YZW","YZX","ZAC","ZBF","ZEM","ZFM","ZGI","ZGR","ZJN","ZKE","ZMT","ZNG","ZNU","ZPB","ZQS","ZRJ","ZSW","ZTM","ZUC","ZWL","ZXH","ZXS","YFO","YGP","YGW","YGX","YHB","YHF","YHI","YHK","YHP","YHR","YHS","YHT","YHU","YHY","YIA","YIB","YIK","YIN","YIO","YIP","YIV","YJA","YJB","YJF","YJL","YJO","YJP","YJQ","YJS","YJT"];

const CITY_NAMES = {
  YYZ: "Toronto", YVR: "Vancouver", YUL: "Montréal", YYC: "Calgary",
  YOW: "Ottawa", YEG: "Edmonton", YHZ: "Halifax", YWG: "Winnipeg",
  YQB: "Québec City", YXE: "Saskatoon", YYT: "St. John's", YYJ: "Victoria",
  YQR: "Regina", YXY: "Whitehorse", YZF: "Yellowknife", YHM: "Hamilton",
};

const COLS = "ABCDEFGHIJKLMNO"; // up to 15 columns supported
const DEFAULT_BOARD_DIM = 10;
const MIN_BOARD_DIM = 6;
const MAX_BOARD_DIM = 15;
// Legacy fixed-size constants kept for any code that hasn't been
// updated to use state.boardDim; default to the classic 10x10 board.
const BOARD_SIZE = 100;
const GRID_COLS = 10;
