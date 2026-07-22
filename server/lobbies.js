// Lobby management: creation, joining (code / invite link), host controls,
// ready system, chat, bots and spectators.

import { randomUUID } from 'crypto';
import { sanitizeRules, DEFAULT_RULES } from './game/rules.js';
import { UnoGame } from './game/engine.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
const MAX_CHAT = 100;
const BOT_NAMES = ['RoboRed', 'ByteBlue', 'GigaGreen', 'YottaYellow', 'CardTron', 'Shuffles', 'Deckard', 'WildBot', 'Drawcula', 'Skipper'];

function cleanText(text, max) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function cleanName(name) {
  return cleanText(name, 20) || 'Player';
}

export function cleanAvatar(avatar) {
  if (typeof avatar !== 'string') return null;
  // Either a short emoji or a small data-URL image (~64px, resized client-side).
  if (avatar.startsWith('data:image/')) {
    return avatar.length <= 40_000 ? avatar : null;
  }
  return avatar.slice(0, 8) || null;
}

export class LobbyManager {
  constructor() {
    this.lobbies = new Map();      // code -> lobby
    this.playerLobby = new Map();  // playerId -> code
  }

  generateCode() {
    for (let len = 6; len <= 8; len++) {
      for (let attempt = 0; attempt < 50; attempt++) {
        let code = '';
        for (let i = 0; i < len; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        if (!this.lobbies.has(code)) return code;
      }
    }
    throw new Error('Could not allocate a lobby code');
  }

  get(code) {
    return this.lobbies.get(String(code || '').toUpperCase().trim());
  }

  lobbyOf(playerId) {
    const code = this.playerLobby.get(playerId);
    return code ? this.lobbies.get(code) : undefined;
  }

  create({ hostId, hostName, hostAvatar, name, maxPlayers, password, rules }) {
    if (this.playerLobby.has(hostId)) this.leave(hostId);
    const code = this.generateCode();
    const lobby = {
      code,
      name: cleanText(name, 40) || `${cleanName(hostName)}'s lobby`,
      password: cleanText(password, 30) || null,
      maxPlayers: Math.max(2, Math.min(10, Math.round(Number(maxPlayers) || 4))),
      hostId,
      status: 'lobby', // 'lobby' | 'playing'
      players: [],
      spectators: [], // { id, name, avatar }
      chat: [],
      rules: sanitizeRules(rules),
      game: null,
      createdAt: Date.now()
    };
    this.lobbies.set(code, lobby);
    this.addPlayer(lobby, { id: hostId, name: hostName, avatar: hostAvatar });
    return lobby;
  }

  addPlayer(lobby, { id, name, avatar, isBot = false, difficulty }) {
    const player = {
      id,
      name: cleanName(name),
      avatar: cleanAvatar(avatar),
      ready: isBot, // bots are always ready
      isBot,
      difficulty: isBot ? (['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium') : undefined,
      connected: true
    };
    lobby.players.push(player);
    if (!isBot) this.playerLobby.set(id, lobby.code);
    return player;
  }

  /** @returns {{ok:true, lobby, role}} or {ok:false, error} */
  join({ playerId, name, avatar, code, password, asSpectator }) {
    const lobby = this.get(code);
    if (!lobby) return { ok: false, error: 'Lobby not found — check the code' };

    // Rejoining a lobby you're already in (e.g. reconnect)
    const existing = lobby.players.find((p) => p.id === playerId);
    if (existing) {
      existing.connected = true;
      this.playerLobby.set(playerId, lobby.code);
      return { ok: true, lobby, role: 'player' };
    }
    const spectating = lobby.spectators.find((s) => s.id === playerId);
    if (spectating) {
      this.playerLobby.set(playerId, lobby.code);
      return { ok: true, lobby, role: 'spectator' };
    }

    if (lobby.password && lobby.password !== cleanText(password, 30)) {
      return { ok: false, error: lobby.password && password ? 'Wrong password' : 'PASSWORD_REQUIRED' };
    }
    if (this.playerLobby.has(playerId)) this.leave(playerId);

    const wantsSpectate = !!asSpectator || lobby.status === 'playing';
    if (wantsSpectate) {
      lobby.spectators.push({ id: playerId, name: cleanName(name), avatar: cleanAvatar(avatar) });
      this.playerLobby.set(playerId, lobby.code);
      return { ok: true, lobby, role: 'spectator' };
    }
    if (lobby.players.length >= lobby.maxPlayers) return { ok: false, error: 'Lobby is full (you can join as a spectator)' };
    this.addPlayer(lobby, { id: playerId, name, avatar });
    return { ok: true, lobby, role: 'player' };
  }

  leave(playerId) {
    const lobby = this.lobbyOf(playerId);
    if (!lobby) return null;
    this.playerLobby.delete(playerId);

    const sIdx = lobby.spectators.findIndex((s) => s.id === playerId);
    if (sIdx !== -1) lobby.spectators.splice(sIdx, 1);

    const pIdx = lobby.players.findIndex((p) => p.id === playerId);
    if (pIdx !== -1) {
      if (lobby.status === 'playing' && lobby.game && !lobby.game.finished) {
        // Mid-game: keep the seat so they can reconnect; mark disconnected.
        lobby.players[pIdx].connected = false;
        lobby.game.setConnected(playerId, false);
        this.playerLobby.set(playerId, lobby.code); // still reachable for reconnect
        return lobby;
      }
      lobby.players.splice(pIdx, 1);
    }

    // Transfer host if needed
    if (lobby.hostId === playerId) {
      const nextHost = lobby.players.find((p) => !p.isBot);
      if (nextHost) lobby.hostId = nextHost.id;
    }
    // Delete the lobby when no humans remain
    if (!lobby.players.some((p) => !p.isBot) && lobby.spectators.length === 0) {
      this.destroyLobby(lobby);
      return null;
    }
    return lobby;
  }

  destroyLobby(lobby) {
    if (lobby.game) lobby.game.destroy();
    for (const p of lobby.players) this.playerLobby.delete(p.id);
    for (const s of lobby.spectators) this.playerLobby.delete(s.id);
    this.lobbies.delete(lobby.code);
  }

  kick(lobby, hostId, targetId) {
    if (lobby.hostId !== hostId) return { ok: false, error: 'Only the host can kick' };
    if (targetId === hostId) return { ok: false, error: "You can't kick yourself" };
    const target = lobby.players.find((p) => p.id === targetId) || lobby.spectators.find((s) => s.id === targetId);
    if (!target) return { ok: false, error: 'Player not found' };
    lobby.players = lobby.players.filter((p) => p.id !== targetId);
    lobby.spectators = lobby.spectators.filter((s) => s.id !== targetId);
    if (!target.isBot) this.playerLobby.delete(targetId);
    return { ok: true, target };
  }

  transferHost(lobby, hostId, targetId) {
    if (lobby.hostId !== hostId) return { ok: false, error: 'Only the host can transfer host' };
    const target = lobby.players.find((p) => p.id === targetId && !p.isBot);
    if (!target) return { ok: false, error: 'Target must be a human player in the lobby' };
    lobby.hostId = targetId;
    return { ok: true };
  }

  addBot(lobby, hostId, difficulty) {
    if (lobby.hostId !== hostId) return { ok: false, error: 'Only the host can add bots' };
    if (lobby.status !== 'lobby') return { ok: false, error: 'Game already started' };
    if (lobby.players.length >= lobby.maxPlayers) return { ok: false, error: 'Lobby is full' };
    const used = new Set(lobby.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot${Math.floor(Math.random() * 1000)}`;
    const bot = this.addPlayer(lobby, { id: 'bot-' + randomUUID(), name, isBot: true, difficulty });
    return { ok: true, bot };
  }

  removeBot(lobby, hostId, botId) {
    if (lobby.hostId !== hostId) return { ok: false, error: 'Only the host can remove bots' };
    const idx = lobby.players.findIndex((p) => p.id === botId && p.isBot);
    if (idx === -1) return { ok: false, error: 'Bot not found' };
    lobby.players.splice(idx, 1);
    return { ok: true };
  }

  setReady(lobby, playerId, ready) {
    const p = lobby.players.find((x) => x.id === playerId);
    if (p) p.ready = !!ready;
  }

  updateRules(lobby, hostId, rules) {
    if (lobby.hostId !== hostId) return { ok: false, error: 'Only the host can change rules' };
    if (lobby.status !== 'lobby') return { ok: false, error: 'Game already started' };
    lobby.rules = sanitizeRules({ ...lobby.rules, ...rules });
    return { ok: true };
  }

  updateSettings(lobby, hostId, { name, maxPlayers, password }) {
    if (lobby.hostId !== hostId) return { ok: false, error: 'Only the host can change settings' };
    if (typeof name === 'string') lobby.name = cleanText(name, 40) || lobby.name;
    if (maxPlayers !== undefined) {
      const m = Math.max(2, Math.min(10, Math.round(Number(maxPlayers) || lobby.maxPlayers)));
      lobby.maxPlayers = Math.max(m, lobby.players.length);
    }
    if (password !== undefined) lobby.password = cleanText(password, 30) || null;
    return { ok: true };
  }

  addChat(lobby, author, text) {
    const msg = {
      id: randomUUID(),
      authorId: author?.id || null,
      author: author ? author.name : 'System',
      system: !author,
      text: cleanText(text, 300),
      at: Date.now()
    };
    if (!msg.text) return null;
    lobby.chat.push(msg);
    if (lobby.chat.length > MAX_CHAT) lobby.chat.splice(0, lobby.chat.length - MAX_CHAT);
    return msg;
  }

  startGame(lobby, hostId, { onUpdate, onEvent, onFinish }) {
    if (lobby.hostId !== hostId) return { ok: false, error: 'Only the host can start the game' };
    if (lobby.status === 'playing') return { ok: false, error: 'Game already running' };
    if (lobby.players.length < 2) return { ok: false, error: 'Need at least 2 players (add a bot!)' };
    const notReady = lobby.players.filter((p) => !p.isBot && p.id !== hostId && !p.ready);
    if (notReady.length > 0) {
      return { ok: false, error: `Waiting for: ${notReady.map((p) => p.name).join(', ')}` };
    }
    lobby.status = 'playing';
    lobby.game = new UnoGame({
      players: lobby.players,
      rules: lobby.rules,
      onUpdate,
      onEvent,
      onFinish
    });
    lobby.game.start();
    return { ok: true };
  }

  endGame(lobby) {
    if (lobby.game) lobby.game.destroy();
    lobby.game = null;
    lobby.status = 'lobby';
    // Drop seats of players who disconnected mid-game and never came back.
    lobby.players = lobby.players.filter((p) => p.isBot || p.connected);
    for (const p of lobby.players) if (!p.isBot) p.ready = false;
    if (!lobby.players.some((p) => p.id === lobby.hostId)) {
      const nextHost = lobby.players.find((p) => !p.isBot);
      if (nextHost) lobby.hostId = nextHost.id;
    }
    if (!lobby.players.some((p) => !p.isBot)) this.destroyLobby(lobby);
  }

  toState(lobby) {
    return {
      code: lobby.code,
      name: lobby.name,
      hasPassword: !!lobby.password,
      maxPlayers: lobby.maxPlayers,
      hostId: lobby.hostId,
      status: lobby.status,
      players: lobby.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        ready: p.ready,
        isBot: p.isBot,
        difficulty: p.difficulty,
        connected: p.connected
      })),
      spectators: lobby.spectators.map((s) => ({ id: s.id, name: s.name, avatar: s.avatar })),
      chat: lobby.chat,
      rules: lobby.rules
    };
  }
}

export { DEFAULT_RULES };
