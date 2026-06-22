// ── Room lifecycle handlers ──────────────────────────────────
// "create_room", "join_room" and "disconnect" — everything to do
// with players entering, leaving and the room shutting down.

const { sanitizeName, sanitizeRoomId, sanitizeBoardDim } = require("../validation");
const { SHIPS, DISCONNECT_GRACE_MS } = require("../constants");

function registerRoomLifecycleHandlers({ io, socket, rooms, leaderboard, deleteRoom }) {
  // ── CREATE ROOM ──
  socket.on("create_room", ({ name, boardDim }) => {
    const cleanName = sanitizeName(name);
    if (!cleanName) return;
    const cleanBoardDim = sanitizeBoardDim(boardDim);

    // If already in a room, leave it first.
    const existingRoomId = rooms.roomIdForSocket(socket.id);
    if (existingRoomId) {
      const oldRoom = rooms.get(existingRoomId);
      if (oldRoom) {
        const opponent = rooms.getOpponent(oldRoom, socket.id);
        if (opponent) io.to(opponent.id).emit("opponent_left");
        deleteRoom(oldRoom.id, "creator left");
      }
    }

    const room = rooms.createRoom(socket.id, cleanName, cleanBoardDim);
    socket.join(room.id);
    leaderboard.ensure(cleanName);
    rooms.scheduleCleanup(room.id, deleteRoom);

    socket.emit("room_created", { roomId: room.id, playerIndex: 0, boardDim: room.boardDim });
    console.log(`Room ${room.id} created by "${cleanName}" (${room.boardDim}x${room.boardDim}). Active rooms: ${rooms.activeRoomCount}`);
  });

  // ── JOIN ROOM ──
  socket.on("join_room", ({ roomId, name }) => {
    const cleanName = sanitizeName(name);
    const cleanRoomId = sanitizeRoomId(roomId);
    if (!cleanName || !cleanRoomId) return;

    const room = rooms.get(cleanRoomId);
    if (!room) return socket.emit("error", "Room not found. Check your code and try again.");
    if (room.players.length >= 2) return socket.emit("error", "This route is already full.");
    if (room.state !== "waiting") return socket.emit("error", "Game already in progress.");

    // Leave old room if any.
    const existingRoomId = rooms.roomIdForSocket(socket.id);
    if (existingRoomId && existingRoomId !== cleanRoomId) {
      const oldRoom = rooms.get(existingRoomId);
      if (oldRoom) {
        const opponent = rooms.getOpponent(oldRoom, socket.id);
        if (opponent) io.to(opponent.id).emit("opponent_left");
        deleteRoom(oldRoom.id, "player moved");
      }
    }

    rooms.joinRoom(room, socket.id, cleanName);
    socket.join(room.id);
    leaderboard.ensure(cleanName);

    room.state = "placing";
    const names = room.players.map((p) => p.name);
    io.to(room.id).emit("both_connected", { names, ships: SHIPS, boardDim: room.boardDim });
    rooms.scheduleCleanup(room.id, deleteRoom);
    console.log(`Room ${room.id}: "${cleanName}" joined.`);
  });

  // ── PROPOSE BOARD SIZE (placement stage only) ──
  // Either player can suggest a new board size while both are still on the
  // placement screen and neither has placed ships yet. The change does NOT
  // take effect immediately — the other player sees a confirm/decline prompt
  // and the resize only applies once they accept. This mirrors the kind of
  // "Player A proposes, Player B confirms" handshake we'd want for a future
  // Teams-based matchmaking flow (see docs/teams-integration.md).
  socket.on("set_board_dim", ({ boardDim }) => {
    const roomId = rooms.roomIdForSocket(socket.id);
    const room = rooms.get(roomId);
    if (!room || room.state !== "placing") return;
    if (room.players.length < 2) return; // nothing to confirm with yet
    if (room.players.some((p) => p.ready)) return; // too late, someone already placed

    const cleanBoardDim = sanitizeBoardDim(boardDim);
    if (cleanBoardDim === room.boardDim) return;

    const proposer = rooms.getSelf(room, socket.id);
    const opponent = rooms.getOpponent(room, socket.id);
    if (!proposer || !opponent) return;

    room.pendingBoardDim = { dim: cleanBoardDim, proposedBy: socket.id };

    socket.emit("board_dim_proposal_sent", { boardDim: cleanBoardDim });
    io.to(opponent.id).emit("board_dim_proposed", {
      boardDim: cleanBoardDim,
      proposedByName: proposer.name,
    });
  });

  // ── RESPOND TO BOARD SIZE PROPOSAL ──
  // The opponent accepts or declines a pending board-size change. On accept,
  // both boards are resized and reset (cell indices change with dimensions).
  // On decline (or if the proposer leaves/disconnects), the room keeps its
  // current size and both players are notified.
  socket.on("board_dim_response", ({ accept }) => {
    const roomId = rooms.roomIdForSocket(socket.id);
    const room = rooms.get(roomId);
    if (!room || room.state !== "placing") return;
    if (!room.pendingBoardDim) return;

    const responder = rooms.getSelf(room, socket.id);
    const proposer = rooms.getOpponent(room, socket.id);
    if (!responder || !proposer) return;
    if (room.pendingBoardDim.proposedBy !== proposer.id) return; // responder must be the non-proposer

    const { dim } = room.pendingBoardDim;
    room.pendingBoardDim = null;

    if (accept) {
      rooms.resizeBoard(room, dim);
      io.to(room.id).emit("board_resized", { boardDim: room.boardDim, confirmedByName: responder.name });
    } else {
      io.to(room.id).emit("board_dim_declined", { boardDim: room.boardDim, declinedByName: responder.name });
    }
  });

  // ── DISCONNECT ──
  socket.on("disconnect", (reason) => {
    console.log(`[-] ${socket.id} disconnected (${reason}). Total: ${io.engine.clientsCount}`);

    const roomId = rooms.roomIdForSocket(socket.id);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    rooms.removeSocket(socket.id);

    const opponent = rooms.getOpponent(room, socket.id);
    if (opponent) io.to(opponent.id).emit("opponent_left");

    // Give the room a short grace window in case the player reconnects.
    setTimeout(() => {
      if (rooms.get(roomId)) deleteRoom(roomId, "disconnect");
    }, DISCONNECT_GRACE_MS);
  });
}

module.exports = { registerRoomLifecycleHandlers };
