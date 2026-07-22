// Central app state: wires the socket to React and exposes actions.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, GameEvent, GameState, LobbyState, Rules } from './types';
import { getSocket, request } from './socket';
import { loadIdentity, saveIdentity, Identity } from './identity';
import { sounds } from './sounds';

export type View = 'home' | 'lobby' | 'game';

interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

interface AppStore {
  connected: boolean;
  view: View;
  identity: Identity;
  role: 'player' | 'spectator';
  lobby: LobbyState | null;
  game: GameState | null;
  chat: ChatMessage[];
  lastEvent: GameEvent | null;
  toasts: Toast[];
  joinCodeFromUrl: string | null;
  defaultRules: Rules | null;

  updateIdentity(partial: Partial<Identity>): void;
  createLobby(opts: { name: string; maxPlayers: number; password: string; rules: Partial<Rules> }): Promise<{ ok: boolean; error?: string }>;
  joinLobby(code: string, password?: string, asSpectator?: boolean): Promise<{ ok: boolean; error?: string }>;
  leaveLobby(): Promise<void>;
  sendChat(text: string): void;
  toast(text: string, kind?: 'error' | 'info'): void;
  clearJoinCode(): void;
}

const Ctx = createContext<AppStore>(null as unknown as AppStore);
export const useApp = () => useContext(Ctx);

let toastSeq = 1;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity());
  const [connected, setConnected] = useState(false);
  const [role, setRole] = useState<'player' | 'spectator'>('player');
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [lastEvent, setLastEvent] = useState<GameEvent | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [defaultRules, setDefaultRules] = useState<Rules | null>(null);
  const [joinCodeFromUrl, setJoinCodeFromUrl] = useState<string | null>(() => {
    const m = window.location.pathname.match(/^\/join\/([A-Za-z0-9]{4,10})/);
    return m ? m[1].toUpperCase() : null;
  });
  const prevTurnRef = useRef<string | null>(null);

  const toast = (text: string, kind: 'error' | 'info' = 'info') => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };

  useEffect(() => {
    const socket = getSocket();

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('session', (s: { inLobby: boolean; role?: 'player' | 'spectator'; lobby?: LobbyState; game?: GameState | null; defaultRules?: Rules }) => {
      if (s.defaultRules) setDefaultRules(s.defaultRules);
      if (s.inLobby && s.lobby) {
        setLobby(s.lobby);
        setChat(s.lobby.chat);
        setRole(s.role || 'player');
        setGame(s.game || null);
      }
    });

    socket.on('lobby:state', (l: LobbyState) => {
      setLobby(l);
      setChat(l.chat);
    });

    socket.on('game:state', (g: GameState) => {
      setGame(g);
      const myId = loadIdentity().playerId;
      if (g.turnPlayerId && g.turnPlayerId !== prevTurnRef.current && g.turnPlayerId === myId && !g.finished) {
        sounds.turn();
      }
      prevTurnRef.current = g.turnPlayerId;
    });

    socket.on('game:event', (ev: GameEvent) => {
      setLastEvent(ev);
      const myId = loadIdentity().playerId;
      switch (ev.type) {
        case 'play': sounds.play(); break;
        case 'draw': sounds.draw(); break;
        case 'uno': sounds.uno(); break;
        case 'caught': sounds.caught(); break;
        case 'penalty': sounds.penalty(); break;
        case 'reshuffle': sounds.shuffle(); break;
        case 'win': ev.playerId === myId ? sounds.victory() : sounds.defeat(); break;
      }
    });

    socket.on('chat:message', (m: ChatMessage) => setChat((c) => [...c.slice(-99), m]));

    socket.on('game:over', () => setGame(null));

    socket.on('lobby:kicked', () => {
      setLobby(null);
      setGame(null);
      setChat([]);
      toast('You were kicked from the lobby', 'error');
    });

    socket.on('lobby:closed', () => {
      setLobby(null);
      setGame(null);
      setChat([]);
      toast('The lobby was closed', 'info');
    });

    socket.on('error:msg', (e: { message: string }) => toast(e.message, 'error'));

    return () => {
      // Remove only the listeners registered here (socket.ts keeps its own).
      for (const ev of ['connect', 'disconnect', 'session', 'lobby:state', 'game:state', 'game:event', 'chat:message', 'game:over', 'lobby:kicked', 'lobby:closed', 'error:msg']) {
        socket.removeAllListeners(ev);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const store = useMemo<AppStore>(() => ({
    connected,
    view: game ? 'game' : lobby ? 'lobby' : 'home',
    identity,
    role,
    lobby,
    game,
    chat,
    lastEvent,
    toasts,
    joinCodeFromUrl,
    defaultRules,

    updateIdentity(partial) {
      setIdentity(saveIdentity(partial));
    },

    async createLobby(opts) {
      const id = loadIdentity();
      const res = await request<{ ok: boolean; error?: string; code?: string }>('lobby:create', {
        playerName: id.name || 'Player',
        avatar: id.avatar,
        name: opts.name,
        maxPlayers: opts.maxPlayers,
        password: opts.password,
        rules: opts.rules
      });
      if (res.ok) setRole('player');
      return res;
    },

    async joinLobby(code, password, asSpectator) {
      const id = loadIdentity();
      const res = await request<{ ok: boolean; error?: string; role?: 'player' | 'spectator'; game?: GameState | null }>('lobby:join', {
        code,
        password,
        asSpectator,
        playerName: id.name || 'Player',
        avatar: id.avatar
      });
      if (res.ok) {
        setRole(res.role || 'player');
        if (res.game) setGame(res.game);
        setJoinCodeFromUrl(null);
        window.history.replaceState(null, '', '/');
      }
      return res;
    },

    async leaveLobby() {
      await request('lobby:leave');
      setLobby(null);
      setGame(null);
      setChat([]);
      window.history.replaceState(null, '', '/');
    },

    sendChat(text) {
      if (text.trim()) getSocket().emit('lobby:chat', { text });
    },

    toast,

    clearJoinCode() {
      setJoinCodeFromUrl(null);
      window.history.replaceState(null, '', '/');
    }
  }), [connected, identity, role, lobby, game, chat, lastEvent, toasts, joinCodeFromUrl, defaultRules]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
