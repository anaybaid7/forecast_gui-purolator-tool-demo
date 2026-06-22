// ── Shared room teardown ─────────────────────────────────────
// A single place that deletes a room AND notifies its players.
// Both the idle-timeout cleanup and the disconnect grace-period
// cleanup route through this so "room_closed" is always emitted
// consistently, no matter what triggered the deletion.

function createRoomCloser(io, rooms) {
  return function deleteRoom(roomId, reason) {
    const room = rooms.delete(roomId);
    if (!room) return;
    room.players.forEach((p) => io.to(p.id).emit("room_closed", { reason }));
    console.log(`Room ${roomId} deleted (${reason}). Active rooms: ${rooms.activeRoomCount}`);
  };
}

module.exports = { createRoomCloser };
