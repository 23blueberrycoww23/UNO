import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { EMOJI_AVATARS } from '../identity';
import type { Rules } from '../types';
import RulesEditor from './RulesEditor';
import StatsPanel from './StatsPanel';
import Avatar from './Avatar';
import { isMuted, setMuted } from '../sounds';

const THEMES = [
  { id: 'classic', label: '🔴 Classic' },
  { id: 'dark', label: '🌙 Dark' },
  { id: 'modern', label: '✨ Modern' }
];

export default function HomePage() {
  const app = useApp();
  const [name, setName] = useState(app.identity.name);
  const [mode, setMode] = useState<'menu' | 'create' | 'join' | 'stats'>('menu');

  // Create form
  const [lobbyName, setLobbyName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [password, setPassword] = useState('');
  const [rules, setRules] = useState<Partial<Rules>>({});
  const [showRules, setShowRules] = useState(false);

  // Join form
  const [code, setCode] = useState(app.joinCodeFromUrl ?? '');
  const [joinPassword, setJoinPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [asSpectator, setAsSpectator] = useState(false);
  const [busy, setBusy] = useState(false);

  const [theme, setTheme] = useState(() => localStorage.getItem('uno.theme') || 'classic');
  const [muted, setMutedState] = useState(isMuted());
  const fileRef = useRef<HTMLInputElement>(null);

  const effectiveRules: Rules = { ...(app.defaultRules || ({} as Rules)), ...rules } as Rules;

  useEffect(() => {
    if (app.joinCodeFromUrl) {
      setCode(app.joinCodeFromUrl);
      setMode('join');
    }
  }, [app.joinCodeFromUrl]);

  const saveName = () => {
    if (name.trim()) app.updateIdentity({ name: name.trim().slice(0, 20) });
  };

  const ensureName = (): boolean => {
    if (!name.trim()) {
      app.toast('Pick a name first!', 'error');
      return false;
    }
    saveName();
    return true;
  };

  const create = async () => {
    if (!ensureName()) return;
    setBusy(true);
    const res = await app.createLobby({ name: lobbyName, maxPlayers, password, rules });
    setBusy(false);
    if (!res.ok) app.toast(res.error || 'Could not create lobby', 'error');
  };

  const join = async (spectate = asSpectator) => {
    if (!ensureName()) return;
    if (!code.trim()) return app.toast('Enter a lobby code', 'error');
    setBusy(true);
    const res = await app.joinLobby(code.trim().toUpperCase(), joinPassword, spectate);
    setBusy(false);
    if (!res.ok) {
      if (res.error === 'PASSWORD_REQUIRED') {
        setNeedsPassword(true);
        app.toast('This lobby needs a password', 'info');
      } else {
        app.toast(res.error || 'Could not join', 'error');
      }
    }
  };

  const uploadAvatar = (file: File) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 64, 64);
      app.updateIdentity({ avatar: canvas.toDataURL('image/jpeg', 0.8) });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };

  const applyTheme = (t: string) => {
    setTheme(t);
    localStorage.setItem('uno.theme', t);
    document.documentElement.dataset.theme = t;
  };

  return (
    <div className="home">
      <header className="home-header">
        <h1 className="logo"><span className="logo-card">UNO</span> Online</h1>
        <div className="header-actions">
          <select value={theme} onChange={(e) => applyTheme(e.target.value)} aria-label="Theme">
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button
            className="btn btn-icon"
            aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
            onClick={() => { setMuted(!muted); setMutedState(!muted); }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      <div className="home-body">
        <section className="panel profile-panel">
          <h3>Your profile</h3>
          <div className="profile-row">
            <button className="avatar-button" onClick={() => fileRef.current?.click()} title="Upload a custom avatar">
              <Avatar avatar={app.identity.avatar} name={name || 'P'} size={64} />
              <span className="avatar-edit">✏️</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])}
            />
            <input
              className="name-input"
              value={name}
              maxLength={20}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              aria-label="Player name"
            />
          </div>
          <div className="emoji-row">
            {EMOJI_AVATARS.map((e) => (
              <button
                key={e}
                className={`emoji-pick ${app.identity.avatar === e ? 'active' : ''}`}
                onClick={() => app.updateIdentity({ avatar: e })}
              >
                {e}
              </button>
            ))}
          </div>
        </section>

        {mode === 'menu' && (
          <section className="menu-buttons">
            <button className="btn btn-big btn-primary" onClick={() => setMode('create')}>🎮 Create Lobby</button>
            <button className="btn btn-big" onClick={() => setMode('join')}>🔗 Join Lobby</button>
            <button className="btn btn-big" onClick={() => setMode('stats')}>📊 Stats & History</button>
          </section>
        )}

        {mode === 'create' && (
          <section className="panel">
            <h3>Create a lobby</h3>
            <label className="field">
              Lobby name
              <input value={lobbyName} maxLength={40} placeholder={`${name || 'Player'}'s lobby`} onChange={(e) => setLobbyName(e.target.value)} />
            </label>
            <label className="field">
              Max players: <strong>{maxPlayers}</strong>
              <input type="range" min={2} max={10} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
            </label>
            <label className="field">
              Password (optional)
              <input type="password" value={password} maxLength={30} placeholder="Leave empty for public" onChange={(e) => setPassword(e.target.value)} />
            </label>

            <button className="btn btn-link" onClick={() => setShowRules(!showRules)}>
              {showRules ? '▾ Hide game rules' : '▸ Configure game rules'}
            </button>
            {showRules && app.defaultRules && (
              <RulesEditor rules={effectiveRules} onChange={(p) => setRules((r) => ({ ...r, ...p }))} />
            )}

            <div className="row gap">
              <button className="btn" onClick={() => setMode('menu')}>Back</button>
              <button className="btn btn-primary" onClick={create} disabled={busy}>Create</button>
            </div>
          </section>
        )}

        {mode === 'join' && (
          <section className="panel">
            <h3>Join a lobby</h3>
            <label className="field">
              Lobby code
              <input
                className="code-input"
                value={code}
                maxLength={8}
                placeholder="ABC123"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && join()}
                autoFocus
              />
            </label>
            {needsPassword && (
              <label className="field">
                Password
                <input type="password" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && join()} autoFocus />
              </label>
            )}
            <label className="check-row">
              <input type="checkbox" checked={asSpectator} onChange={(e) => setAsSpectator(e.target.checked)} />
              Join as spectator 👁
            </label>
            <div className="row gap">
              <button className="btn" onClick={() => { setMode('menu'); app.clearJoinCode(); }}>Back</button>
              <button className="btn btn-primary" onClick={() => join()} disabled={busy}>Join</button>
            </div>
          </section>
        )}

        {mode === 'stats' && (
          <>
            <StatsPanel />
            <button className="btn" onClick={() => setMode('menu')}>Back</button>
          </>
        )}
      </div>

      <footer className="home-footer">Play with 2-10 players · house rules · bots · spectators</footer>
    </div>
  );
}
