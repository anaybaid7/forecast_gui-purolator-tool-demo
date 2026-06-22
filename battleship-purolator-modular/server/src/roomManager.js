// ── Room management ──────────────────────────────────────────
// Owns the in-memory room store and the helpers for creating,
// looking up and tearing down rooms. Socket handlers call into
// this module rather than touching the `rooms` map directly, so
// the storage strategy (in-memory today) can change later without
// rewriting the game logic.

const { ROOM_ID_LENGTH, ROOM_TIMEOUT_MS, BOARD_SIZE, DEFAULT_BOARD_DIM } = require("./constants");

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> room
    this.socketToRoom = new Map(); // socketId -> roomId
  }

  /** Generate a unique, human-friendly room code (e.g. "K7QXM"). */
  generateRoomId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
    let id = "";
    for (let i = 0; i < ROOM_ID_LENGTH; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return this.rooms.has(id) ? this.generateRoomId() : id;
  }

  createPlayer(socketId, name, boardSize = BOARD_SIZE) {
    return {
      id: socketId,
      name,
      board: Array(boardSize).fill(null),
      ships: [],
      ready: false,
      hits: 0,
      shotsFired: 0,
      shotsHit: 0,
      rematch: false,
    };
  }

  get(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomForSocket(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  roomIdForSocket(socketId) {
    return this.socketToRoom.get(socketId);
  }

  /** Create a new room with a single player and register the socket. */
  createRoom(socketId, name, boardDim = DEFAULT_BOARD_DIM) {
    const roomId = this.generateRoomId();
    const boardSize = boardDim * boardDim;
    const room = {
      id: roomId,
      boardDim,
      boardSize,
      pendingBoardDim: null, // { dim, proposedBy } while a resize awaits the other player's confirmation
      players: [this.createPlayer(socketId, name, boardSize)],
      turn: null,
      state: "waiting",
      startedAt: null,
      cleanupTimer: null,
    };
    this.rooms.set(roomId, room);
    this.socketToRoom.set(socketId, roomId);
    return room;
  }

  /** Add a second player to an existing room. */
  joinRoom(room, socketId, name) {
    room.players.push(this.createPlayer(socketId, name, room.boardSize));
    this.socketToRoom.set(socketId, room.id);
  }

  getOpponent(room, socketId) {
    return room.players.find((p) => p.id !== socketId);
  }

  getSelf(room, socketId) {
    return room.players.find((p) => p.id === socketId);
  }

  /** (Re)start the idle-timeout for a room, deleting it after ROOM_TIMEOUT_MS. */
  scheduleCleanup(roomId, onTimeout) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => onTimeout(roomId, "timeout"), ROOM_TIMEOUT_MS);
  }

  /** Remove a room and clear its bookkeeping. Does not notify sockets. */
  delete(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.players.forEach((p) => this.socketToRoom.delete(p.id));
    this.rooms.delete(roomId);
    return room;
  }

  removeSocket(socketId) {
    this.socketToRoom.delete(socketId);
  }

  /** Reset both players' boards/ships for a rematch in place. */
  resetForRematch(room) {
    room.players.forEach((p) => {
      p.board = Array(room.boardSize).fill(null);
      p.ships = [];
      p.ready = false;
      p.hits = 0;
      p.shotsFired = 0;
      p.shotsHit = 0;
      p.rematch = false;
    });
    room.turn = null;
    room.state = "placing";
    room.pendingBoardDim = null;
  }

  /** Resize a room's board (only safe while no one has placed ships yet). */
  resizeBoard(room, boardDim) {
    room.boardDim = boardDim;
    room.boardSize = boardDim * boardDim;
    room.players.forEach((p) => {
      p.board = Array(room.boardSize).fill(null);
      p.ships = [];
      p.ready = false;
    });
  }

  get activeRoomCount() {
    return this.rooms.size;
  }
}

module.exports = { RoomManager };
