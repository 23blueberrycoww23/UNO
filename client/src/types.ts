// Shared client-side type definitions mirroring server payloads.

export type CardColor = 'red' | 'yellow' | 'green' | 'blue' | 'wild';
export type CardValue =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  id: string;
  color: CardColor;
  value: CardValue;
}

export interface Rules {
  drawTwo: boolean;
  reverse: boolean;
  skip: boolean;
  wild: boolean;
  wildDrawFour: boolean;
  stackDraw2: boolean;
  stackDraw4: boolean;
  stackDraw4OnDraw2: boolean;
  stackLimit: number;
  sevenZero: boolean;
  jumpIn: boolean;
  forcePlay: boolean;
  drawUntilPlayable: boolean;
  challengeDrawFour: boolean;
  noBluffing: boolean;
  startingCards: number;
  turnTime: number;
  unoTime: number;
  unoPenalty: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  avatar: string | null;
  ready: boolean;
  isBot: boolean;
  difficulty?: 'easy' | 'medium' | 'hard';
  connected: boolean;
}

export interface ChatMessage {
  id: string;
  authorId: string | null;
  author: string;
  system: boolean;
  text: string;
  at: number;
}

export interface LobbyState {
  code: string;
  name: string;
  hasPassword: boolean;
  maxPlayers: number;
  hostId: string;
  status: 'lobby' | 'playing';
  players: LobbyPlayer[];
  spectators: { id: string; name: string; avatar: string | null }[];
  chat: ChatMessage[];
  rules: Rules;
}

export interface GamePlayer {
  id: string;
  name: string;
  avatar: string | null;
  isBot: boolean;
  difficulty?: string;
  connected: boolean;
  handCount: number;
  saidUno: boolean;
  unoVulnerable: boolean;
  isTurn: boolean;
}

export interface RankingEntry {
  place: number;
  id: string;
  name: string;
  isBot: boolean;
  cardsLeft: number;
  score: number;
}

export interface GameState {
  players: GamePlayer[];
  yourHand: Card[];
  playableIds: string[];
  pendingDrawnCardId: string | null;
  discardTop: Card | null;
  currentColor: CardColor | null;
  direction: 1 | -1;
  drawPileCount: number;
  pendingDraw: number;
  pendingType: 'draw2' | 'wild4' | null;
  challenge: { victimId: string; offenderId: string } | null;
  turnPlayerId: string | null;
  turnEndsAt: number;
  finished: boolean;
  winnerId: string | null;
  ranking: RankingEntry[] | null;
  rules: Rules;
}

export interface GameEvent {
  type: string;
  playerId?: string;
  targetId?: string;
  by?: string;
  against?: string;
  card?: Card;
  color?: string;
  count?: number;
  success?: boolean;
  direction?: number;
  at: number;
}

export interface PlayerStats {
  name?: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  cardsPlayed: number;
  drawCardsTaken: number;
  unoCalls: number;
}

export interface MatchRecord {
  id: string;
  at: number;
  lobbyName: string;
  lobbyCode: string;
  durationMs: number;
  winner: string | null;
  players: { id: string | null; name: string; isBot: boolean; place: number; cardsLeft: number; score: number }[];
}
