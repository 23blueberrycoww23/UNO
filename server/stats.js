// Player statistics and match history, persisted as JSON on disk.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MAX_HISTORY = 500;

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export class StatsStore {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.stats = loadJson(STATS_FILE, {});     // playerId -> aggregate stats
    this.history = loadJson(HISTORY_FILE, []); // newest first
    this._saveTimer = null;
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2));
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history.slice(0, MAX_HISTORY), null, 2));
      } catch (e) {
        console.error('[stats] failed to persist:', e.message);
      }
    }, 500);
  }

  ensure(playerId, name) {
    if (!this.stats[playerId]) {
      this.stats[playerId] = {
        name,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        cardsPlayed: 0,
        drawCardsTaken: 0,
        unoCalls: 0
      };
    }
    if (name) this.stats[playerId].name = name;
    return this.stats[playerId];
  }

  /**
   * Record a finished game.
   * @param {object} results  { winnerId, ranking, durationMs, playerStats }
   * @param {object} lobby    lobby the game ran in
   */
  recordGame(results, lobby) {
    for (const [playerId, ps] of Object.entries(results.playerStats)) {
      if (ps.isBot) continue;
      const s = this.ensure(playerId, ps.name);
      s.gamesPlayed += 1;
      if (playerId === results.winnerId) s.wins += 1;
      else s.losses += 1;
      s.cardsPlayed += ps.cardsPlayed;
      s.drawCardsTaken += ps.drawCardsTaken;
      s.unoCalls += ps.unoCalls;
    }

    this.history.unshift({
      id: randomUUID(),
      at: Date.now(),
      lobbyName: lobby.name,
      lobbyCode: lobby.code,
      durationMs: results.durationMs,
      winner: results.ranking[0]?.name || null,
      players: results.ranking.map((r) => ({
        id: r.isBot ? null : r.id, // never leak bot internals; keep human ids for filtering
        name: r.name,
        isBot: r.isBot,
        place: r.place,
        cardsLeft: r.cardsLeft,
        score: r.score
      }))
    });
    if (this.history.length > MAX_HISTORY) this.history.length = MAX_HISTORY;
    this._scheduleSave();
  }

  getStats(playerId) {
    const s = this.stats[playerId];
    if (!s) return null;
    return {
      ...s,
      winRate: s.gamesPlayed > 0 ? Math.round((s.wins / s.gamesPlayed) * 1000) / 10 : 0
    };
  }

  getHistory(playerId, limit = 50) {
    return this.history
      .filter((m) => m.players.some((p) => p.id === playerId))
      .slice(0, limit);
  }
}
