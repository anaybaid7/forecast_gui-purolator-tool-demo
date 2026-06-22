// ── Purolator Driver Battle League — server entrypoint ───────
// Wires together the room manager, leaderboard and socket
// handlers. Game rules and constants live in src/, this file is
// just bootstrapping + the health check endpoint.

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const { RoomManager } = require("./src/roomManager");
const { Leaderboard } = require("./src/leaderboard");
const { createRoomCloser } = require("./src/roomCloser");
const { registerRoomLifecycleHandlers } = require("./src/handlers/roomLifecycle");
const { registerGameplayHandlers } = require("./src/handlers/gameplay");
const { LEADERBOARD_SIZE } = require("./src/constants");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 20000,
  pingInterval: 10000,
  maxHttpBufferSize: 1e6,
  transports: ["websocket", "polling"],
});

app.use(express.static(path.join(__dirname, "../public")));

// ── Shared state ─────────────────────────────────────────────
const rooms = new RoomManager();
const leaderboard = new Leaderboard();
const deleteRoom = createRoomCloser(io, rooms);

function broadcastLeaderboard() {
  io.emit("leaderboard_update", leaderboard.top(LEADERBOARD_SIZE));
}

// ── Socket.io ─────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[+] ${socket.id} connected. Total: ${io.engine.clientsCount}`);

  // Send current leaderboard to the new connection.
  socket.emit("leaderboard_update", leaderboard.top(LEADERBOARD_SIZE));

  const ctx = { io, socket, rooms, leaderboard, deleteRoom, broadcastLeaderboard };
  registerRoomLifecycleHandlers(ctx);
  registerGameplayHandlers(ctx);
});

// ── Health check endpoint ─────────────────────────────────────
app.get("/status", (_req, res) => {
  res.json({
    activeRooms: rooms.activeRoomCount,
    connectedPlayers: io.engine.clientsCount,
    leaderboardEntries: leaderboard.size,
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚚 Purolator Battleship running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/status`);
});
