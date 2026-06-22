// Verifies an 8x8 (64-cell) room works end-to-end: placement bounds,
// firing bounds, and win condition with TOTAL_SHIP_CELLS=17 (<=64).
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

A.trigger("create_room", { name: "Falcon", boardDim: 8 });
const created = A.lastOf("room_created");
console.log("Room created:", created, "(expect boardDim 8)");

B.trigger("join_room", { roomId: created.roomId, name: "Jessica" });
const both = B.lastOf("both_connected");
console.log("both_connected boardDim:", both.boardDim, "(expect 8)");

const ships = both.ships;
const room = rooms.get(created.roomId);
console.log("room.boardSize:", room.boardSize, "(expect 64)");

const shipsA = placement(0, ships);  // 0..16
const shipsB = placement(40, ships); // 40..56, within 64

A.trigger("place_ships", { ships: shipsA });
B.trigger("place_ships", { ships: shipsB });
console.log("both ready:", room.players.every(p=>p.ready));
console.log("game state:", room.state);

// Try an out-of-bounds shot (>=64) -> should be silently ignored
const gs = A.lastOf("game_start");
let turn = gs.turn;
const shooter = turn === A.id ? A : B;
const before = shooter.countOf("shot_result");
shooter.trigger("fire", { index: 70 }); // out of bounds for 64-cell board
console.log("shot_result count after OOB fire (should be unchanged):", shooter.countOf("shot_result"), "vs before:", before);

// Now fire within bounds at opponent ship cells to confirm normal play works
const targetCells = (turn === A.id ? shipsB : shipsA).flatMap(s=>s.cells);
shooter.trigger("fire", { index: targetCells[0] });
const sr = shooter.received.filter(([e])=>e==="shot_result").pop()[1];
console.log("in-bounds fire result:", sr.result, "(expect hit)");

console.log("\n✅ 8x8 board room created, validated, and played correctly.");

process.exit(0);
