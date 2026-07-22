import { useEffect, useState } from 'react';
import type { MatchRecord, PlayerStats } from '../types';
import { useApp } from '../store';

export default function StatsPanel() {
  const app = useApp();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [history, setHistory] = useState<MatchRecord[]>([]);
  const [tab, setTab] = useState<'stats' | 'history'>('stats');

  useEffect(() => {
    const id = app.identity.playerId;
    fetch(`/api/stats/${id}`).then((r) => r.json()).then(setStats).catch(() => {});
    fetch(`/api/history/${id}`).then((r) => r.json()).then(setHistory).catch(() => {});
  }, [app.identity.playerId]);

  return (
    <div className="panel stats-panel">
      <div className="tabs">
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>📊 Statistics</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>📜 Match History</button>
      </div>

      {tab === 'stats' && stats && (
        <div className="stats-grid">
          <Stat label="Games" value={stats.gamesPlayed} />
          <Stat label="Wins" value={stats.wins} />
          <Stat label="Losses" value={stats.losses} />
          <Stat label="Win rate" value={`${stats.winRate}%`} />
          <Stat label="Cards played" value={stats.cardsPlayed} />
          <Stat label="Cards drawn" value={stats.drawCardsTaken} />
          <Stat label="UNO calls" value={stats.unoCalls} />
        </div>
      )}

      {tab === 'history' && (
        <div className="history-list">
          {history.length === 0 && <p className="muted">No matches yet — play your first game!</p>}
          {history.map((m) => {
            const me = m.players.find((p) => p.id === app.identity.playerId);
            const won = me?.place === 1;
            return (
              <div key={m.id} className={`history-item ${won ? 'won' : ''}`}>
                <div>
                  <strong>{won ? '🏆 Victory' : `#${me?.place ?? '-'} of ${m.players.length}`}</strong>
                  <span className="muted"> · {m.lobbyName}</span>
                </div>
                <div className="muted small">
                  {new Date(m.at).toLocaleString()} · {Math.round(m.durationMs / 60000)} min ·
                  {' '}winner: {m.winner}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
