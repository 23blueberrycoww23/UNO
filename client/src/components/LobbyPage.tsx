import { useState } from 'react';
import { useApp } from '../store';
import { getSocket, request } from '../socket';
import RulesEditor from './RulesEditor';
import Chat from './Chat';
import Avatar from './Avatar';

export default function LobbyPage() {
  const app = useApp();
  const lobby = app.lobby!;
  const myId = app.identity.playerId;
  const isHost = lobby.hostId === myId;
  const me = lobby.players.find((p) => p.id === myId);
  const isSpectator = !me;
  const [showRules, setShowRules] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [copied, setCopied] = useState<string | null>(null);

  const inviteLink = `${window.location.origin}/join/${lobby.code}`;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      app.toast('Copy failed — select it manually', 'error');
    }
  };

  const start = async () => {
    const res = await request('lobby:start');
    if (!res.ok) app.toast((res as { error?: string }).error || 'Could not start', 'error');
  };

  const humanCount = lobby.players.filter((p) => !p.isBot).length;
  const allReady = lobby.players.filter((p) => !p.isBot && p.id !== lobby.hostId).every((p) => p.ready);
  const canStart = isHost && lobby.players.length >= 2 && allReady;

  return (
    <div className="lobby">
      <header className="lobby-header">
        <div>
          <h2>{lobby.name} {lobby.hasPassword && '🔒'}</h2>
          <div className="lobby-meta">
            <button className="code-chip" onClick={() => copy(lobby.code, 'code')} title="Copy lobby code">
              {lobby.code} {copied === 'code' ? '✓' : '⧉'}
            </button>
            <button className="btn btn-small" onClick={() => copy(inviteLink, 'link')}>
              {copied === 'link' ? '✓ Copied!' : '🔗 Copy invite link'}
            </button>
          </div>
        </div>
        <button className="btn btn-danger-outline" onClick={() => app.leaveLobby()}>Leave</button>
      </header>

      <div className="lobby-body">
        <section className="panel players-panel">
          <h3>Players ({lobby.players.length}/{lobby.maxPlayers})</h3>
          <ul className="player-list">
            {lobby.players.map((p) => (
              <li key={p.id} className={`player-row ${!p.connected ? 'disconnected' : ''}`}>
                <Avatar avatar={p.avatar} name={p.name} size={36} />
                <span className="player-name">
                  {p.name}
                  {p.id === lobby.hostId && <span className="badge badge-host">HOST</span>}
                  {p.isBot && <span className="badge badge-bot">🤖 {p.difficulty}</span>}
                  {p.id === myId && <span className="badge">you</span>}
                  {!p.connected && <span className="badge badge-warn">offline</span>}
                </span>
                <span className={`ready-dot ${p.ready || p.id === lobby.hostId ? 'ready' : ''}`}>
                  {p.id === lobby.hostId ? '👑' : p.ready ? '✅' : '⌛'}
                </span>
                {isHost && p.id !== myId && (
                  <span className="host-actions">
                    {!p.isBot && (
                      <button className="btn btn-tiny" title="Transfer host" onClick={() => getSocket().emit('lobby:transferHost', { targetId: p.id })}>👑</button>
                    )}
                    <button
                      className="btn btn-tiny btn-danger-outline"
                      title={p.isBot ? 'Remove bot' : 'Kick player'}
                      onClick={() => getSocket().emit(p.isBot ? 'lobby:removeBot' : 'lobby:kick', p.isBot ? { botId: p.id } : { targetId: p.id })}
                    >
                      ✖
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>

          {lobby.spectators.length > 0 && (
            <p className="muted">👁 Spectators: {lobby.spectators.map((s) => s.name).join(', ')}</p>
          )}

          {isHost && lobby.players.length < lobby.maxPlayers && (
            <div className="row gap bot-row">
              <select value={botDifficulty} onChange={(e) => setBotDifficulty(e.target.value as 'easy' | 'medium' | 'hard')} aria-label="Bot difficulty">
                <option value="easy">Easy bot</option>
                <option value="medium">Medium bot</option>
                <option value="hard">Hard bot</option>
              </select>
              <button className="btn btn-small" onClick={() => getSocket().emit('lobby:addBot', { difficulty: botDifficulty })}>
                + Add bot
              </button>
            </div>
          )}

          <div className="lobby-actions">
            {!isSpectator && !isHost && (
              <button
                className={`btn btn-big ${me?.ready ? '' : 'btn-primary'}`}
                onClick={() => getSocket().emit('lobby:ready', { ready: !me?.ready })}
              >
                {me?.ready ? 'Not ready' : "I'm ready!"}
              </button>
            )}
            {isHost && (
              <button className="btn btn-big btn-primary" onClick={start} disabled={!canStart} title={!canStart ? 'Need 2+ players, everyone ready' : ''}>
                ▶ Start game
              </button>
            )}
            {isSpectator && <p className="muted">You are spectating. The game view opens when it starts.</p>}
          </div>
          {humanCount === 1 && <p className="muted">Tip: share the invite link, or add bots to play solo.</p>}
        </section>

        <section className="panel rules-panel">
          <button className="btn btn-link" onClick={() => setShowRules(!showRules)}>
            {showRules ? '▾ Game rules' : '▸ Game rules'} {isHost ? '(you can edit)' : '(host only)'}
          </button>
          {showRules && (
            <RulesEditor
              rules={lobby.rules}
              readOnly={!isHost}
              onChange={(partial) => getSocket().emit('lobby:updateRules', { rules: { ...lobby.rules, ...partial } })}
            />
          )}
        </section>

        <section className="panel chat-panel">
          <h3>Chat</h3>
          <Chat />
        </section>
      </div>
    </div>
  );
}
