import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { getSocket } from '../socket';
import type { Card, CardColor, GameEvent } from '../types';
import CardView from './CardView';
import Avatar from './Avatar';
import Chat from './Chat';
import { isMuted, setMuted } from '../sounds';

const COLOR_NAMES: Record<string, string> = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };

export default function GamePage() {
  const app = useApp();
  const game = app.game!;
  const myId = app.identity.playerId;
  const me = game.players.find((p) => p.id === myId);
  const isSpectator = !me;
  const isMyTurn = game.turnPlayerId === myId;

  const [pendingWild, setPendingWild] = useState<Card | null>(null);
  const [pendingSeven, setPendingSeven] = useState<{ card: Card; color?: CardColor } | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [banner, setBanner] = useState<{ text: string; big?: boolean } | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const bannerTimer = useRef<number>();

  const myIndex = game.players.findIndex((p) => p.id === myId);
  const opponents = useMemo(() => {
    // Seat opponents in turn order starting after me (or all players for spectators).
    if (myIndex === -1) return game.players;
    const list = [];
    for (let i = 1; i < game.players.length; i++) {
      list.push(game.players[(myIndex + i) % game.players.length]);
    }
    return list;
  }, [game.players, myIndex]);

  // ---- event banners ------------------------------------------------------
  useEffect(() => {
    if (!app.lastEvent) return;
    const text = eventText(app.lastEvent, game.players.map((p) => ({ id: p.id, name: p.id === myId ? 'You' : p.name })));
    if (!text) return;
    setBanner({ text, big: ['uno', 'win', 'caught', 'challenge'].includes(app.lastEvent.type) });
    window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), 2600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.lastEvent]);

  // ---- actions ------------------------------------------------------------
  const emit = (event: string, payload: Record<string, unknown> = {}) => getSocket().emit(event, payload, () => {});

  const playCard = (card: Card, color?: CardColor, swapTargetId?: string) => {
    if (card.color === 'wild' && !color) {
      setPendingWild(card);
      return;
    }
    if (game.rules.sevenZero && card.value === '7' && !swapTargetId && game.players.length > 1) {
      setPendingSeven({ card, color });
      return;
    }
    setPendingWild(null);
    setPendingSeven(null);
    emit('game:play', {
      cardId: card.id,
      color,
      swapTargetId,
      declareUno: me ? me.handCount === 2 && me.saidUno : false
    });
  };

  const callUno = () => emit('game:uno');
  const draw = () => emit('game:draw');
  const pass = () => emit('game:pass');

  const challengeMe = game.challenge?.victimId === myId;
  const offender = game.challenge ? game.players.find((p) => p.id === game.challenge!.offenderId) : null;

  const canCallUno = me && me.handCount <= 2 && !me.saidUno && !game.finished;

  return (
    <div className="game">
      {/* ------- header ------- */}
      <header className="game-header">
        <div className="game-header-left">
          <button className="btn btn-small btn-danger-outline" onClick={() => app.leaveLobby()}>Leave</button>
          {isSpectator && <span className="badge badge-warn">👁 Spectating</span>}
        </div>
        <div className="game-header-right">
          <span className="pile-info">🂠 {game.drawPileCount}</span>
          <button className="btn btn-icon" onClick={() => { setMuted(!muted); setMutedState(!muted); }} aria-label="Toggle sound">
            {muted ? '🔇' : '🔊'}
          </button>
          <button className={`btn btn-icon ${showChat ? 'active' : ''}`} onClick={() => setShowChat(!showChat)} aria-label="Toggle chat">💬</button>
        </div>
      </header>

      {/* ------- opponents ------- */}
      <div className="opponents">
        {opponents.map((p) => (
          <div key={p.id} className={`opponent ${p.isTurn ? 'turn' : ''} ${!p.connected ? 'disconnected' : ''}`}>
            <Avatar avatar={p.avatar} name={p.name} size={44} />
            <span className="opp-name">{p.name}{p.isBot ? ' 🤖' : ''}</span>
            <div className="opp-cards">
              {Array.from({ length: Math.min(p.handCount, 8) }).map((_, i) => (
                <div key={i} className="mini-card-back" style={{ marginLeft: i === 0 ? 0 : -10 }} />
              ))}
              <span className="opp-count">{p.handCount}</span>
            </div>
            {p.saidUno && p.handCount === 1 && <span className="uno-flag">UNO!</span>}
            {p.unoVulnerable && !isSpectator && (
              <button className="btn btn-tiny btn-catch" onClick={() => emit('game:catch', { targetId: p.id })}>
                ☝ Catch!
              </button>
            )}
            {!p.connected && <span className="badge badge-warn">offline</span>}
          </div>
        ))}
      </div>

      {/* ------- table center ------- */}
      <div className="table-center">
        <div className={`direction-ring dir-${game.direction === 1 ? 'cw' : 'ccw'}`} aria-label="Play direction">
          {game.direction === 1 ? '⟳' : '⟲'}
        </div>

        <div className="piles">
          <div className="draw-pile-wrap">
            <CardView
              card={{ id: 'back', color: 'wild', value: 'wild' }}
              faceDown
              onClick={isMyTurn && !game.finished && !challengeMe ? draw : undefined}
              style={undefined}
            />
            {isMyTurn && game.pendingDraw > 0 && !challengeMe && (
              <span className="draw-warning">Draw {game.pendingDraw}</span>
            )}
          </div>

          <div className="discard-wrap">
            {game.discardTop && (
              <CardView key={game.discardTop.id} card={game.discardTop} overlayColor={game.currentColor} style={undefined} />
            )}
          </div>
        </div>

        <div className="status-line">
          {game.currentColor && game.currentColor !== 'wild' && (
            <span className={`color-pill pill-${game.currentColor}`}>{COLOR_NAMES[game.currentColor]}</span>
          )}
          {game.pendingDraw > 0 && <span className="stack-pill">+{game.pendingDraw} stacked</span>}
          <span className="turn-label">
            {game.finished
              ? 'Game over'
              : game.turnPlayerId === myId
                ? '✨ Your turn'
                : `${game.players.find((p) => p.id === game.turnPlayerId)?.name}'s turn`}
          </span>
        </div>

        {game.turnEndsAt > 0 && !game.finished && <TurnTimer endsAt={game.turnEndsAt} total={game.rules.turnTime} />}
      </div>

      {/* ------- banner ------- */}
      {banner && <div className={`event-banner ${banner.big ? 'big' : ''}`}>{banner.text}</div>}

      {/* ------- my hand ------- */}
      {!isSpectator && (
        <div className="my-area">
          <div className="hand" role="list">
            {game.yourHand.map((card, i) => {
              const playable = game.playableIds.includes(card.id);
              return (
                <CardView
                  key={card.id}
                  card={card}
                  playable={playable && !game.finished}
                  onClick={playable && !game.finished ? () => playCard(card) : undefined}
                  style={{ zIndex: i, animationDelay: `${i * 40}ms` }}
                />
              );
            })}
          </div>
          <div className="action-bar">
            <button className="btn" onClick={draw} disabled={!isMyTurn || game.finished || !!game.pendingDrawnCardId || challengeMe}>
              {game.pendingDraw > 0 && isMyTurn ? `Draw ${game.pendingDraw}` : 'Draw'}
            </button>
            {game.pendingDrawnCardId && isMyTurn && (
              <button className="btn" onClick={pass}>Keep & pass</button>
            )}
            <button className={`btn btn-uno ${canCallUno ? 'pulse' : ''}`} onClick={callUno} disabled={!canCallUno}>
              UNO!
            </button>
          </div>
        </div>
      )}

      {/* ------- modals ------- */}
      {pendingWild && (
        <Modal title="Choose a color" onClose={() => setPendingWild(null)}>
          <div className="color-grid">
            {(['red', 'yellow', 'green', 'blue'] as CardColor[]).map((c) => (
              <button key={c} className={`color-choice choice-${c}`} onClick={() => playCard(pendingWild, c)}>
                {COLOR_NAMES[c]}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {pendingSeven && (
        <Modal title="Swap hands with…" onClose={() => setPendingSeven(null)}>
          <div className="swap-grid">
            {game.players.filter((p) => p.id !== myId).map((p) => (
              <button key={p.id} className="btn swap-choice" onClick={() => playCard(pendingSeven.card, pendingSeven.color, p.id)}>
                <Avatar avatar={p.avatar} name={p.name} size={32} /> {p.name} ({p.handCount})
              </button>
            ))}
          </div>
        </Modal>
      )}

      {challengeMe && !game.finished && (
        <Modal title={`${offender?.name ?? 'Someone'} played a Wild +4`}>
          <p>You can challenge if you think it was illegal. If you're right they draw {game.pendingDraw}; if you're wrong you draw {game.pendingDraw + 2}.</p>
          <div className="row gap">
            <button className="btn btn-primary" onClick={() => emit('game:challenge', { accept: true })}>⚖ Challenge!</button>
            <button className="btn" onClick={() => emit('game:challenge', { accept: false })}>Draw {game.pendingDraw}</button>
          </div>
        </Modal>
      )}

      {game.finished && game.ranking && (
        <Modal title={game.winnerId === myId ? '🏆 You win!' : `🏁 ${game.ranking[0].name} wins!`}>
          <ol className="ranking">
            {game.ranking.map((r) => (
              <li key={r.id} className={r.id === myId ? 'me' : ''}>
                <span className="place">#{r.place}</span> {r.name}{r.isBot ? ' 🤖' : ''}
                <span className="muted"> — {r.place === 1 ? `${r.score} pts` : `${r.cardsLeft} cards left`}</span>
              </li>
            ))}
          </ol>
          {game.winnerId === myId && <div className="confetti" aria-hidden>{'🎉🎊✨🎉🎊'.split('').join(' ')}</div>}
          <p className="muted">Returning to the lobby shortly…</p>
          {app.lobby?.hostId === myId && (
            <button className="btn btn-primary" onClick={() => emit('lobby:backToLobby')}>Back to lobby now</button>
          )}
        </Modal>
      )}

      {/* ------- chat drawer ------- */}
      {showChat && (
        <div className="chat-drawer">
          <div className="chat-drawer-head">
            <strong>Chat</strong>
            <button className="btn btn-tiny" onClick={() => setShowChat(false)}>✖</button>
          </div>
          <Chat compact />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function TurnTimer({ endsAt, total }: { endsAt: number; total: number }) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const remaining = Math.max(0, endsAt - Date.now());
      setPct(Math.min(100, (remaining / (total * 1000)) * 100));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [endsAt, total]);
  return (
    <div className="turn-timer" aria-hidden>
      <div className={`turn-timer-fill ${pct < 25 ? 'low' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        {onClose && <button className="modal-close" onClick={onClose} aria-label="Close">✖</button>}
      </div>
    </div>
  );
}

function eventText(ev: GameEvent, players: { id: string; name: string }[]): string | null {
  const name = (id?: string) => players.find((p) => p.id === id)?.name ?? 'Someone';
  switch (ev.type) {
    case 'uno': return `${name(ev.playerId)} called UNO! 🚨`;
    case 'caught': return `${name(ev.playerId)} got caught — +${ev.count}! ☝`;
    case 'penalty': return `${name(ev.playerId)} draws ${ev.count} 😬`;
    case 'skip': return `${name(ev.playerId)} was skipped ⊘`;
    case 'reverse': return 'Direction reversed ⇄';
    case 'swap': return `${name(ev.playerId)} swapped hands with ${name(ev.targetId)} 🔄`;
    case 'rotate': return 'All hands rotated! 🌀';
    case 'jumpIn': return `${name(ev.playerId)} jumped in! ⚡`;
    case 'challenge': return ev.success ? `Challenge succeeded! ⚖` : `Challenge failed! ⚖`;
    case 'reshuffle': return 'Deck reshuffled 🔀';
    case 'timeout': return `${name(ev.playerId)} ran out of time ⏰`;
    case 'forcePlay': return `Force play! ${name(ev.playerId)}'s drawn card was played`;
    case 'win': return `${name(ev.playerId)} WINS! 🏆`;
    default: return null;
  }
}
