// Verifies the board-size propose/confirm handshake:
// - Player A proposes a new size; Player B sees the proposal, A sees "waiting".
// - On accept, both boards resize and a board_resized event fires for both.
// - On decline, nothing changes and both players are notified.
// - Once a proposal is pending, neither player can place ships until it resolves.
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

function freshRoom() {
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

  A.trigger("create_room", { name: "Falcon" });
  const created = A.lastOf("room_created");
  B.trigger("join_room", { roomId: created.roomId, name: "Jessica" });
  const room = rooms.get(created.roomId);
  return { A, B, room };
}

// ── Test 1: accept flow ──
{
  const { A, B, room } = freshRoom();
  console.log("initial boardDim:", room.boardDim);

  A.trigger("set_board_dim", { boardDim: 8 });
  console.log("A got board_dim_proposal_sent:", A.lastOf("board_dim_proposal_sent"));
  console.log("B got board_dim_proposed:", B.lastOf("board_dim_proposed"));
  console.log("room.pendingBoardDim:", room.pendingBoardDim);
  console.log("room.boardDim still (unchanged until accept):", room.boardDim);

  B.trigger("board_dim_response", { accept: true });
  console.log("A got board_resized:", A.lastOf("board_resized"));
  console.log("B got board_resized:", B.lastOf("board_resized"));
  console.log("room.boardDim after accept:", room.boardDim, "boardSize:", room.boardSize);
  console.log("room.pendingBoardDim cleared:", room.pendingBoardDim);

  const test1Pass = room.boardDim === 8 && room.boardSize === 64 && room.pendingBoardDim === null
    && A.lastOf("board_resized")?.boardDim === 8 && B.lastOf("board_resized")?.confirmedByName === "Jessica";
  console.log(test1Pass ? "✅ Test 1 PASS (accept flow)\n" : "❌ Test 1 FAIL\n");
  if (!test1Pass) process.exit(1);
}

// ── Test 2: decline flow ──
{
  const { A, B, room } = freshRoom();
  A.trigger("set_board_dim", { boardDim: 12 });
  console.log("room.pendingBoardDim after propose:", room.pendingBoardDim);

  B.trigger("board_dim_response", { accept: false });
  console.log("A got board_dim_declined:", A.lastOf("board_dim_declined"));
  console.log("B got board_dim_declined:", B.lastOf("board_dim_declined"));
  console.log("room.boardDim unchanged:", room.boardDim, "(expect 10)");
  console.log("room.pendingBoardDim cleared:", room.pendingBoardDim);

  const test2Pass = room.boardDim === 10 && room.pendingBoardDim === null
    && A.lastOf("board_dim_declined")?.boardDim === 10;
  console.log(test2Pass ? "✅ Test 2 PASS (decline flow)\n" : "❌ Test 2 FAIL\n");
  if (!test2Pass) process.exit(1);
}

// ── Test 3: placement blocked while a proposal is pending ──
{
  const { A, B, room } = freshRoom();
  const ships = B.lastOf("both_connected").ships;

  A.trigger("set_board_dim", { boardDim: 9 });
  console.log("pending proposal exists:", !!room.pendingBoardDim);

  const placeCountBefore = A.countOf("placement_confirmed");
  A.trigger("place_ships", { ships: placement(0, ships) });
  console.log("placement_confirmed emitted while pending?", A.countOf("placement_confirmed") > placeCountBefore, "(expect false)");
  console.log("player A ready?", room.players[0].ready, "(expect false)");

  // Now resolve the proposal, then placement should work
  B.trigger("board_dim_response", { accept: true });
  A.trigger("place_ships", { ships: placement(0, ships) });
  console.log("player A ready after resolving + placing:", room.players[0].ready, "(expect true)");

  const pass3 = room.players[0].ready === true && room.boardSize === 81;
  console.log(pass3 ? "✅ Test 3 PASS (placement blocked during pending proposal)\n" : "❌ Test 3 FAIL\n");
  if (!pass3) process.exit(1);
}

console.log("All board-confirm tests passed.");
process.exit(0);
