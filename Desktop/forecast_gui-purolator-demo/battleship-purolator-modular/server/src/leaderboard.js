// ── Leaderboard ──────────────────────────────────────────────
// Stats are aggregated by player NAME, not by socket id. A socket
// id is only valid for a single connection, so a player who plays
// twice in a row (e.g. wins, returns to the lobby, plays again
// under the same callsign) would otherwise end up as two separate
// rows. Keying by name merges those sessions into one running
// total, which is the behaviour the in-office leaderboard is meant
// to show.
//
// Names are matched case-insensitively and trimmed so "Falcon",
// "falcon" and " Falcon " all roll up into the same entry. The most
// recently used casing is kept as the display name.

const { LEADERBOARD_SIZE } = require("./constants");

class Leaderboard {
  constructor() {
    // key: normalized name (lowercase, trimmed) -> stats
    this.entries = new Map();
  }

  static normalize(name) {
    return name.trim().toLowerCase();
  }

  /**
   * Ensure an entry exists for this name and return its key.
   * Updates the display name to whatever casing was used most recently.
   */
  ensure(name) {
    const key = Leaderboard.normalize(name);
    const displayName = name.trim();
    if (!this.entries.has(key)) {
      this.entries.set(key, {
        name: displayName,
        wins: 0,
        losses: 0,
        shots: 0,
        hits: 0,
      });
    } else {
      this.entries.get(key).name = displayName;
    }
    return key;
  }

  recordShot(name, { isHit }) {
    const key = this.ensure(name);
    const stats = this.entries.get(key);
    stats.shots += 1;
    if (isHit) stats.hits += 1;
  }

  recordWin(name) {
    const key = this.ensure(name);
    this.entries.get(key).wins += 1;
  }

  recordLoss(name) {
    const key = this.ensure(name);
    this.entries.get(key).losses += 1;
  }

  /**
   * Top N entries sorted by wins, then by hits as a tiebreaker.
   * Returns plain objects safe to send to clients.
   */
  top(limit = LEADERBOARD_SIZE) {
    return Array.from(this.entries.values())
      .map((stats) => ({ ...stats }))
      .sort((a, b) => b.wins - a.wins || b.hits - a.hits)
      .slice(0, limit);
  }

  get size() {
    return this.entries.size;
  }
}

module.exports = { Leaderboard };
