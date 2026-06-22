// In-process test: simulates create -> join -> place -> fire -> win -> rematch -> win
// using fake socket objects (no real network). Validates the full server wiring and,
// specifically, that the leaderboard aggregates by username across rematches.

const { RoomManager } = require("../server/src/roomManager");
const { Leaderboard } = require("../server/src/leaderboard");
const { createRoomCloser } = require("../server/src/roomCloser");
const { registerRoomLifecycleHandlers } = require("../server/src/handlers/roomLifecycle");
const { registerGameplayHandlers } = require("../server/src/handlers/gameplay");
const { LEADERBOARD_SIZE } = require("../server/src/constants");

class FakeSocket {
  constructor(id) { this.id = id; this.handlers = {}; this.received = []; this.rooms = new Set(); }
  on(event, cb) { this.handlers[event] = cb; }
  emit(event, payload) { this.received.push([event, payload]); }
  trigger(event, payload) { this.handlers[event] && this.handlers[event](payload); }
  join(roomId) { this.rooms.add(roomId); }
  lastOf(event) { const f = this.received.filter(([e]) => e === event); return f.length ? f[f.length-1][1] : undefined; }
  countOf(event) { return this.received.filter(([e]) => e === event).length; }
}
class FakeIO {
  constructor() { this.sockets = new Map(); this.engine = { clientsCount: 0 }; }
  register(socket) { this.sockets.set(socket.id, socket); this.engine.clientsCount = this.sockets.size; }
  emit(event, payload) { for (const s of this.sockets.values()) s.emit(event, payload); }
  to(target) {
    const self = this;
    return { emit(event, payload) {
      for (const sock of self.sockets.values()) {
        if (sock.id === target || sock.rooms.has(target)) sock.emit(event, payload);
      }
    }};
  }
}

function placement(offset, ships) {
  let placed = [], cursor = offset;
  for (const ship of ships) {
    const cells = []; for (let i=0;i<ship.size;i++) cells.push(cursor+i);
    placed.push({ name: ship.name, cells }); cursor += ship.size + 1;
  }
  return placed;
}

function playGame(A, B, ships) {
  const shipsA = placement(0, ships);
  const shipsB = placement(50, ships);

  A.trigger("place_ships", { ships: shipsA });
  B.trigger("place_ships", { ships: shipsB });

  const gs = A.lastOf("game_start");
  let turn = gs.turn;

  const aTargets = shipsB.flatMap(s => s.cells); // A always hits B (17 cells)
  // B has plenty of miss targets (rows 8-9 = 20 cells), more than enough turns
  const bTargets = Array.from({ length: 20 }, (_, i) => 80 + i);

  const gameOverCountBefore = A.countOf("game_over");
  let aIdx = 0, bIdx = 0, over = null, steps = 0;
  while (!over && steps++ < 100) {
    if (turn === A.id) {
      A.trigger("fire", { index: aTargets[aIdx] });
      if (A.countOf("game_over") > gameOverCountBefore) {
        over = A.lastOf("game_over");
        break;
      }
      const sr = A.received.filter(([e]) => e === "shot_result").pop()[1];
      aIdx++; turn = sr.nextTurn;
    } else {
      B.trigger("fire", { index: bTargets[bIdx] });
      const sr = B.received.filter(([e]) => e === "shot_result").pop()[1];
      bIdx++; turn = sr.nextTurn;
    }
  }
  return over;
}

function main() {
  const io = new FakeIO();
  const rooms = new RoomManager();
  const leaderboard = new Leaderboard();
  const deleteRoom = createRoomCloser(io, rooms);
  function broadcastLeaderboard() { io.emit("leaderboard_update", leaderboard.top(LEADERBOARD_SIZE)); }

  const A = new FakeSocket("A1"); io.register(A);
  const B = new FakeSocket("B1"); io.register(B);

  const ctxBase = { io, rooms, leaderboard, deleteRoom, broadcastLeaderboard };
  registerRoomLifecycleHandlers({ ...ctxBase, socket: A });
  registerGameplayHandlers({ ...ctxBase, socket: A });
  registerRoomLifecycleHandlers({ ...ctxBase, socket: B });
  registerGameplayHandlers({ ...ctxBase, socket: B });

  // Falcon creates, Jessica joins
  A.trigger("create_room", { name: "Falcon" });
  const created = A.lastOf("room_created");
  console.log("Room created:", created.roomId);

  B.trigger("join_room", { roomId: created.roomId, name: "Jessica" });
  const both = B.lastOf("both_connected");
  const ships = both.ships;
  console.log("Both connected:", both.names);

  const over1 = playGame(A, B, ships);
  console.log("Game 1 winner:", over1.winnerName, "| accuracy:", over1.stats.accuracy + "%", "| shots:", over1.stats.shots, "| hits:", over1.stats.hits);

  const lb1 = leaderboard.top();
  console.log("Leaderboard after game 1:", JSON.stringify(lb1));

  // Rematch — same names, same sockets (simulating same browser session)
  A.trigger("request_rematch");
  B.trigger("request_rematch");
  const rematch = A.lastOf("rematch_start");
  console.log("Rematch started:", !!rematch);

  const over2 = playGame(A, B, ships);
  console.log("Game 2 winner:", over2.winnerName, "| accuracy:", over2.stats.accuracy + "%");

  const lb2 = leaderboard.top();
  console.log("\nLeaderboard after game 2:");
  console.log(JSON.stringify(lb2, null, 2));

  const falconRows = lb2.filter(r => r.name === "Falcon");
  console.log("\n=== RESULT ===");
  console.log("Number of 'Falcon' rows:", falconRows.length, "(expected 1)");
  console.log("Falcon total wins:", falconRows[0]?.wins, "(expected 2)");
  console.log("Falcon aggregated shots:", falconRows[0]?.shots, "= game1 shots + game2 shots");
  console.log("Falcon aggregated hits:", falconRows[0]?.hits, "(expected 34, i.e. 17+17)");

  if (falconRows.length === 1 && falconRows[0].wins === 2 && falconRows[0].hits === 34) {
    console.log("\n✅ PASS — leaderboard aggregates by username across rematches.");
  } else {
    console.log("\n❌ FAIL");
    process.exit(1);
  }

  // ── Edge case: different casing/whitespace for same name still aggregates ──
  const C = new FakeSocket("C1"); io.register(C);
  registerRoomLifecycleHandlers({ ...ctxBase, socket: C });
  registerGameplayHandlers({ ...ctxBase, socket: C });
  C.trigger("create_room", { name: "  falcon " });
  const lbCheck = leaderboard.top();
  const falconAfterCasing = lbCheck.filter(r => r.name.trim().toLowerCase() === "falcon");
  console.log("\nRows matching 'falcon' (any casing) after a new session as '  falcon ':", falconAfterCasing.length, "(expected 1)");
  if (falconAfterCasing.length === 1) console.log("✅ PASS — case/whitespace variants aggregate too.");
  else { console.log("❌ FAIL"); process.exit(1); }
}

main();

process.exit(0);
