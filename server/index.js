// UNO server: Express + Socket.IO entry point.
//
// Server-authoritative: clients only ever send *intents*; every action is
// validated by the lobby manager / game engine before any state changes.

import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import express from 'express';
import { Server } from 'socket.io';

import { LobbyManager, cleanName, cleanAvatar } from './lobbies.js';
import { StatsStore } from './stats.js';
import { DEFAULT_RULES } from './game/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const PRODUCTION = process.env.NODE_ENV === 'production' || process.argv.includes('--production');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 256 * 1024
});

const lobbies = new LobbyManager();
const stats = new StatsStore();
const identities = new Map(); // playerId -> secret token (anti-impersonation)

// ------------------------------------------------------------------ HTTP

app.use(express.json({ limit: '64kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, lobbies: lobbies.lobbies.size }));

app.get('/api/stats/:playerId', (req, res) => {
  const s = stats.getStats(String(req.params.playerId).slice(0, 64));
  res.json(s || { gamesPlayed: 0, wins: 0, losses: 0, winRate: 0, cardsPlayed: 0, drawCardsTaken: 0, unoCalls: 0 });
});

app.get('/api/history/:playerId', (req, res) => {
  res.json(stats.getHistory(String(req.params.playerId).slice(0, 64)));
});

app.get('/api/lobby/:code', (req, res) => {
  const lobby = lobbies.get(req.params.code);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  res.json({
    code: lobby.code,
    name: lobby.name,
    hasPassword: !!lobby.password,
    players: lobby.players.length,
    maxPlayers: lobby.maxPlayers,
    status: lobby.status
  });
});

// Serve the built client in production (single-port deployment)
if (PRODUCTION) {
  const dist = path.join(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    console.warn('[server] client/dist not found — run "npm run build" first.');
  }
}

// ------------------------------------------------------ socket rate limit

const RATE = { windowMs: 4000, maxEvents: 40, maxChat: 6 };

function makeLimiter() {
  return { windowStart: Date.now(), events: 0, chat: 0 };
}

function allow(socket, kind = 'event') {
  const rl = socket.data.rl;
  const now = Date.now();
  if (now - rl.windowStart > RATE.windowMs) {
    rl.windowStart = now;
    rl.events = 0;
    rl.chat = 0;
  }
  if (kind === 'chat') {
    rl.chat++;
    if (rl.chat > RATE.maxChat) return false;
  }
  rl.events++;
  return rl.events <= RATE.maxEvents;
}

// ------------------------------------------------------------ broadcasting

function lobbyRoom(lobby) {
  return `lobby:${lobby.code}`;
}

function sendLobbyState(lobby) {
  io.to(lobbyRoom(lobby)).emit('lobby:state', lobbies.toState(lobby));
}

/** Send each participant their own sanitized view of the game. */
function sendGameState(lobby) {
  if (!lobby.game) return;
  for (const p of lobby.players) {
    if (!p.isBot) io.to(`p:${p.id}`).emit('game:state', lobby.game.stateFor(p.id));
  }
  for (const s of lobby.spectators) {
    io.to(`p:${s.id}`).emit('game:state', lobby.game.stateFor(null));
  }
}

function sendGameEvent(lobby, event) {
  io.to(lobbyRoom(lobby)).emit('game:event', { ...event, at: Date.now() });
}

function systemChat(lobby, text) {
  const msg = lobbies.addChat(lobby, null, text);
  if (msg) io.to(lobbyRoom(lobby)).emit('chat:message', msg);
}

function gameCallbacks(lobby) {
  return {
    onUpdate: () => sendGameState(lobby),
    onEvent: (ev) => sendGameEvent(lobby, ev),
    onFinish: (results) => {
      stats.recordGame(results, lobby);
      const winner = results.ranking[0];
      systemChat(lobby, `🏆 ${winner.name} wins the game!`);
      sendGameState(lobby);
      // Return everyone to the lobby after the win screen.
      setTimeout(() => {
        const current = lobbies.get(lobby.code);
        if (!current || current.game?.finished !== true) return;
        lobbies.endGame(current);
        if (lobbies.get(lobby.code)) {
          io.to(lobbyRoom(current)).emit('game:over');
          sendLobbyState(current);
        } else {
          io.to(lobbyRoom(current)).emit('lobby:closed');
        }
      }, 10_000);
    }
  };
}

// ----------------------------------------------------------------- sockets

io.use((socket, next) => {
  const { playerId, token } = socket.handshake.auth || {};
  if (typeof playerId !== 'string' || typeof token !== 'string' ||
      playerId.length < 8 || playerId.length > 64 || token.length < 8 || token.length > 128) {
    return next(new Error('BAD_AUTH'));
  }
  const known = identities.get(playerId);
  if (known && known !== token) return next(new Error('BAD_AUTH')); // impersonation attempt
  if (!known) identities.set(playerId, token);
  socket.data.playerId = playerId;
  socket.data.rl = makeLimiter();
  next();
});

io.on('connection', (socket) => {
  const playerId = socket.data.playerId;
  socket.join(`p:${playerId}`);

  // ---- reconnect / state recovery -------------------------------------
  const existing = lobbies.lobbyOf(playerId);
  if (existing) {
    socket.join(lobbyRoom(existing));
    const seat = existing.players.find((p) => p.id === playerId);
    if (seat && !seat.connected) {
      seat.connected = true;
      if (existing.game) existing.game.setConnected(playerId, true);
      systemChat(existing, `${seat.name} reconnected`);
    }
    const isSpectator = existing.spectators.some((s) => s.id === playerId);
    socket.emit('session', {
      inLobby: true,
      role: isSpectator ? 'spectator' : 'player',
      lobby: lobbies.toState(existing),
      game: existing.game ? existing.game.stateFor(isSpectator ? null : playerId) : null
    });
    sendLobbyState(existing);
  } else {
    socket.emit('session', { inLobby: false, defaultRules: DEFAULT_RULES });
  }

  const fail = (message) => socket.emit('error:msg', { message });

  function guarded(handler, kind = 'event') {
    return (payload = {}, ack) => {
      try {
        if (!allow(socket, kind)) return fail('Slow down…');
        if (typeof payload !== 'object' || payload === null) payload = {};
        handler(payload, typeof ack === 'function' ? ack : () => {});
      } catch (e) {
        console.error('[socket] handler error:', e);
        fail('Something went wrong');
      }
    };
  }

  // ---- lobby lifecycle --------------------------------------------------

  socket.on('lobby:create', guarded((p, ack) => {
    const lobby = lobbies.create({
      hostId: playerId,
      hostName: cleanName(p.playerName),
      hostAvatar: cleanAvatar(p.avatar),
      name: p.name,
      maxPlayers: p.maxPlayers,
      password: p.password,
      rules: p.rules
    });
    socket.join(lobbyRoom(lobby));
    systemChat(lobby, `Lobby created. Invite code: ${lobby.code}`);
    ack({ ok: true, code: lobby.code });
    sendLobbyState(lobby);
  }));

  socket.on('lobby:join', guarded((p, ack) => {
    const result = lobbies.join({
      playerId,
      name: cleanName(p.playerName),
      avatar: cleanAvatar(p.avatar),
      code: p.code,
      password: p.password,
      asSpectator: !!p.asSpectator
    });
    if (!result.ok) return ack({ ok: false, error: result.error });
    const { lobby, role } = result;
    socket.join(lobbyRoom(lobby));
    const me = lobby.players.find((x) => x.id === playerId) || lobby.spectators.find((x) => x.id === playerId);
    systemChat(lobby, `${me?.name || 'Someone'} joined${role === 'spectator' ? ' as a spectator' : ''}`);
    ack({
      ok: true,
      code: lobby.code,
      role,
      game: lobby.game ? lobby.game.stateFor(role === 'spectator' ? null : playerId) : null
    });
    sendLobbyState(lobby);
    if (lobby.game) sendGameState(lobby);
  }));

  socket.on('lobby:leave', guarded((_p, ack) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return ack({ ok: true });
    const me = lobby.players.find((x) => x.id === playerId) || lobby.spectators.find((x) => x.id === playerId);
    // An explicit leave always vacates the seat, even mid-game.
    lobby.players = lobby.players.filter((x) => x.id !== playerId || x.isBot);
    lobby.spectators = lobby.spectators.filter((x) => x.id !== playerId);
    lobbies.playerLobby.delete(playerId);
    socket.leave(lobbyRoom(lobby));

    if (lobby.game && !lobby.game.finished) {
      lobby.game.setConnected(playerId, false);
    }
    if (lobby.hostId === playerId) {
      const next = lobby.players.find((x) => !x.isBot);
      if (next) {
        lobby.hostId = next.id;
        systemChat(lobby, `${next.name} is now the host`);
      }
    }
    if (!lobby.players.some((x) => !x.isBot)) {
      io.to(lobbyRoom(lobby)).emit('lobby:closed');
      lobbies.destroyLobby(lobby);
    } else {
      if (me) systemChat(lobby, `${me.name} left`);
      sendLobbyState(lobby);
      if (lobby.game) sendGameState(lobby);
    }
    ack({ ok: true });
  }));

  socket.on('lobby:kick', guarded((p) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return fail('Not in a lobby');
    if (lobby.status === 'playing') return fail("Can't kick during a game");
    const r = lobbies.kick(lobby, playerId, String(p.targetId || ''));
    if (!r.ok) return fail(r.error);
    io.to(`p:${r.target.id}`).emit('lobby:kicked');
    io.sockets.sockets.forEach((s) => {
      if (s.data.playerId === r.target.id) s.leave(lobbyRoom(lobby));
    });
    systemChat(lobby, `${r.target.name} was kicked`);
    sendLobbyState(lobby);
  }));

  socket.on('lobby:transferHost', guarded((p) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return fail('Not in a lobby');
    const r = lobbies.transferHost(lobby, playerId, String(p.targetId || ''));
    if (!r.ok) return fail(r.error);
    const target = lobby.players.find((x) => x.id === p.targetId);
    systemChat(lobby, `${target.name} is now the host`);
    sendLobbyState(lobby);
  }));

  socket.on('lobby:ready', guarded((p) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby || lobby.status !== 'lobby') return;
    lobbies.setReady(lobby, playerId, !!p.ready);
    sendLobbyState(lobby);
  }));

  socket.on('lobby:updateRules', guarded((p) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return fail('Not in a lobby');
    const r = lobbies.updateRules(lobby, playerId, p.rules || {});
    if (!r.ok) return fail(r.error);
    sendLobbyState(lobby);
  }));

  socket.on('lobby:updateSettings', guarded((p) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return fail('Not in a lobby');
    const r = lobbies.updateSettings(lobby, playerId, p);
    if (!r.ok) return fail(r.error);
    sendLobbyState(lobby);
  }));

  socket.on('lobby:addBot', guarded((p) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return fail('Not in a lobby');
    const r = lobbies.addBot(lobby, playerId, p.difficulty);
    if (!r.ok) return fail(r.error);
    systemChat(lobby, `🤖 ${r.bot.name} (${r.bot.difficulty}) joined`);
    sendLobbyState(lobby);
  }));

  socket.on('lobby:removeBot', guarded((p) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return fail('Not in a lobby');
    const r = lobbies.removeBot(lobby, playerId, String(p.botId || ''));
    if (!r.ok) return fail(r.error);
    sendLobbyState(lobby);
  }));

  socket.on('lobby:chat', guarded((p) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return;
    const author = lobby.players.find((x) => x.id === playerId) || lobby.spectators.find((x) => x.id === playerId);
    if (!author) return;
    const msg = lobbies.addChat(lobby, author, p.text);
    if (msg) io.to(lobbyRoom(lobby)).emit('chat:message', msg);
  }, 'chat'));

  socket.on('lobby:start', guarded((_p, ack) => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return ack({ ok: false, error: 'Not in a lobby' });
    const r = lobbies.startGame(lobby, playerId, gameCallbacks(lobby));
    if (!r.ok) return ack({ ok: false, error: r.error });
    systemChat(lobby, '🎮 Game started — good luck!');
    ack({ ok: true });
    sendLobbyState(lobby);
    sendGameState(lobby);
  }));

  // ---- in-game actions (all validated by the engine) --------------------

  function gameAction(fn) {
    return guarded((p, ack) => {
      const lobby = lobbies.lobbyOf(playerId);
      if (!lobby || !lobby.game) return ack({ ok: false, error: 'No active game' });
      if (lobby.spectators.some((s) => s.id === playerId)) {
        return ack({ ok: false, error: 'Spectators cannot play' });
      }
      const result = fn(lobby.game, p);
      if (!result.ok) {
        ack(result);
        socket.emit('error:msg', { message: result.error });
        return;
      }
      ack({ ok: true });
      sendGameState(lobby);
    });
  }

  socket.on('game:play', gameAction((game, p) =>
    game.handlePlay(playerId, {
      cardId: String(p.cardId || ''),
      color: typeof p.color === 'string' ? p.color : undefined,
      swapTargetId: typeof p.swapTargetId === 'string' ? p.swapTargetId : undefined,
      declareUno: !!p.declareUno
    })
  ));

  socket.on('game:draw', gameAction((game) => game.handleDraw(playerId)));
  socket.on('game:pass', gameAction((game) => game.handlePass(playerId)));
  socket.on('game:uno', gameAction((game) => game.handleUno(playerId)));
  socket.on('game:catch', gameAction((game, p) => game.handleCatch(playerId, String(p.targetId || ''))));
  socket.on('game:challenge', gameAction((game, p) => game.handleChallenge(playerId, !!p.accept)));

  socket.on('game:requestState', guarded(() => {
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby || !lobby.game) return;
    const isSpectator = lobby.spectators.some((s) => s.id === playerId);
    socket.emit('game:state', lobby.game.stateFor(isSpectator ? null : playerId));
  }));

  socket.on('lobby:backToLobby', guarded(() => {
    // Host can end a finished game immediately instead of waiting.
    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby || !lobby.game || !lobby.game.finished) return;
    if (lobby.hostId !== playerId) return;
    lobbies.endGame(lobby);
    const still = lobbies.get(lobby.code);
    if (still) {
      io.to(lobbyRoom(lobby)).emit('game:over');
      sendLobbyState(lobby);
    } else {
      io.to(lobbyRoom(lobby)).emit('lobby:closed');
    }
  }));

  // ---- disconnect --------------------------------------------------------

  socket.on('disconnect', () => {
    // Other open sockets for this player (multiple tabs) keep the seat alive.
    const stillConnected = [...io.sockets.sockets.values()].some(
      (s) => s.id !== socket.id && s.data.playerId === playerId
    );
    if (stillConnected) return;

    const lobby = lobbies.lobbyOf(playerId);
    if (!lobby) return;

    if (lobby.status === 'playing' && lobby.game && !lobby.game.finished) {
      const seat = lobby.players.find((x) => x.id === playerId);
      if (seat) {
        seat.connected = false;
        lobby.game.setConnected(playerId, false);
        systemChat(lobby, `${seat.name} disconnected — they can rejoin`);
        sendLobbyState(lobby);
        return;
      }
    }
    // In the lobby phase a short grace period allows page refreshes.
    setTimeout(() => {
      const l = lobbies.lobbyOf(playerId);
      if (!l) return;
      const reconnected = [...io.sockets.sockets.values()].some((s) => s.data.playerId === playerId);
      if (reconnected) return;
      if (l.status === 'playing') return; // handled above
      const me = l.players.find((x) => x.id === playerId) || l.spectators.find((x) => x.id === playerId);
      const remaining = lobbies.leave(playerId);
      if (remaining) {
        if (me) systemChat(remaining, `${me.name} left`);
        sendLobbyState(remaining);
      }
    }, 15_000);
  });
});

// ------------------------------------------------------------------- boot

httpServer.listen(PORT, () => {
  console.log(`\n  UNO server listening on port ${PORT}`);
  if (PRODUCTION) {
    const nets = os.networkInterfaces();
    const addrs = Object.values(nets).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
    console.log(`  Play at:  http://localhost:${PORT}`);
    for (const a of addrs) console.log(`            http://${a.address}:${PORT}  (LAN)`);
  } else {
    console.log('  Development mode — the client runs on http://localhost:3000\n');
  }
});
