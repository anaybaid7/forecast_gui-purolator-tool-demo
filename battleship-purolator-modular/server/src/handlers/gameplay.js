// ── Gameplay handlers ─────────────────────────────────────────
// "place_ships", "fire" and "request_rematch" — the core
// turn-by-turn game loop once both players are in a room.

const { SHIPS, TOTAL_SHIP_CELLS } = require("../constants");
const { isValidPlacement, isValidShotIndex } = require("../validation");

function registerGameplayHandlers({ io, socket, rooms, leaderboard, broadcastLeaderboard, deleteRoom }) {
  // ── PLACE SHIPS ──
  socket.on("place_ships", ({ ships: placedShips }) => {
    const roomId = rooms.roomIdForSocket(socket.id);
    const room = rooms.get(roomId);
    if (!room || room.state !== "placing") return;

    const player = rooms.getSelf(room, socket.id);
    if (!player || player.ready) return;
    if (room.pendingBoardDim) return; // wait for the board-size handshake to resolve first

    if (!isValidPlacement(placedShips, SHIPS, room.boardSize)) return;

    player.ships = placedShips;
    placedShips.forEach((ship) => {
      ship.cells.forEach((idx) => {
        player.board[idx] = "ship";
      });
    });
    player.ready = true;

    socket.emit("placement_confirmed");
    rooms.scheduleCleanup(roomId, deleteRoom);

    if (room.players.every((p) => p.ready)) {
      room.state = "playing";
      room.startedAt = Date.now();
      room.turn = room.players[Math.floor(Math.random() * 2)].id;
      io.to(roomId).emit("game_start", { turn: room.turn });
      console.log(`Room ${roomId}: game started.`);
    }
  });

  // ── FIRE ──
  socket.on("fire", ({ index }) => {
    const roomId = rooms.roomIdForSocket(socket.id);
    const room = rooms.get(roomId);
    if (!room || room.state !== "playing") return;
    if (room.turn !== socket.id) return;
    if (!isValidShotIndex(index, room.boardSize)) return;

    const opponent = rooms.getOpponent(room, socket.id);
    const self = rooms.getSelf(room, socket.id);
    if (!opponent || !self) return;

    const cell = opponent.board[index];
    if (cell === "hit" || cell === "miss") return;

    const isHit = cell === "ship";
    opponent.board[index] = isHit ? "hit" : "miss";
    self.shotsFired++;
    if (isHit) {
      opponent.hits++;
      self.shotsHit++;
    }
    leaderboard.recordShot(self.name, { isHit });

    rooms.scheduleCleanup(roomId, deleteRoom);

    if (opponent.hits >= TOTAL_SHIP_CELLS) {
      finishGame({ io, room, winner: self, loser: opponent, leaderboard, broadcastLeaderboard, index });
      return;
    }

    room.turn = opponent.id;
    io.to(roomId).emit("shot_result", {
      index,
      result: isHit ? "hit" : "miss",
      firedBy: socket.id,
      nextTurn: room.turn,
    });
  });

  // ── REMATCH ──
  socket.on("request_rematch", () => {
    const roomId = rooms.roomIdForSocket(socket.id);
    const room = rooms.get(roomId);
    if (!room || room.state !== "done") return;

    const player = rooms.getSelf(room, socket.id);
    if (!player) return;
    player.rematch = true;

    if (room.players.every((p) => p.rematch)) {
      rooms.resetForRematch(room);
      io.to(roomId).emit("rematch_start", { ships: SHIPS, boardDim: room.boardDim });
      rooms.scheduleCleanup(roomId, deleteRoom);
    } else {
      const opponent = rooms.getOpponent(room, socket.id);
      if (opponent) io.to(opponent.id).emit("rematch_requested");
    }
  });
}

/**
 * Apply a winning shot: mark the room done, update the leaderboard
 * (aggregated by player name, so repeat sessions accumulate), and
 * notify both players of the result.
 */
function finishGame({ io, room, winner, loser, leaderboard, broadcastLeaderboard, index }) {
  room.state = "done";
  const duration = Math.round((Date.now() - room.startedAt) / 1000);
  const accuracy = winner.shotsFired > 0
    ? Math.round((winner.shotsHit / winner.shotsFired) * 100)
    : 0;

  leaderboard.recordWin(winner.name);
  leaderboard.recordLoss(loser.name);

  io.to(room.id).emit("shot_result", { index, result: "hit", firedBy: winner.id });
  io.to(room.id).emit("game_over", {
    winner: winner.id,
    winnerName: winner.name,
    stats: {
      shots: winner.shotsFired,
      hits: winner.shotsHit,
      accuracy,
      duration,
    },
  });
  broadcastLeaderboard();
}

module.exports = { registerGameplayHandlers };
