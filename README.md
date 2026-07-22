# UNO Online 🎴

A professional, full-featured multiplayer UNO game with real-time lobbies, configurable house rules, AI bots, spectators, reconnection, statistics and match history.

**Stack:** React + TypeScript (Vite) · Node.js + Express · Socket.IO

---

## Quick start

```bash
npm install
npm start
```

That's it. The single `npm install` installs the root, server and client packages; `npm start` launches both the backend (port **3001**) and the frontend (port **3000**) together.

Open **http://localhost:3000**, pick a name, create a lobby and share the invite link — e.g. `http://192.168.1.10:3000/join/ABC123` (the dev server is exposed on your LAN automatically).

> Playing solo? Add bots from the lobby (Easy / Medium / Hard) and press Start.

## Production

```bash
npm install
npm run build        # builds the client into client/dist
npm run start:prod   # single server serving game + UI on port 3001
```

In production everything runs on one port: **http://localhost:3001** (set `PORT` to change it). Invite links work the same way.

---

## Features

### Lobby system
- **Create lobby** — name, max players (2–10), optional password, full rules configuration
- **Join** via 6–8 character lobby code or direct invite link (`/join/CODE`)
- Player list with connection status, **ready system**, lobby **chat**
- **Host controls:** kick players, transfer host, add/remove bots, edit rules, start game
- **Spectator mode** — watch any game without playing (auto-offered when a game is running or the lobby is full)

### Rules configuration (host)
| Category | Options |
| --- | --- |
| Official cards | Toggle Draw Two, Reverse, Skip, Wild, Wild Draw Four |
| Stacking | +2 on +2, +4 on +4, +4 on +2, stack limit (0 = unlimited / progressive) |
| House rules | Seven-Zero (7 = swap hands, 0 = rotate hands), Jump-In, Force Play, Draw Until Playable, Challenge Draw Four, No Bluffing |
| Tuning | Starting cards (3–12), turn timer (0–120 s), UNO call window, UNO penalty (1–8 cards) |

### Gameplay
- Full official 108-card deck with correct counts, shuffling, and automatic reshuffle of the discard pile
- Turn timer with on-screen countdown; auto-draw on timeout
- Reverse direction, skips, accumulating draw penalties, wild color selection
- **UNO button** — call UNO at ≤2 cards; opponents get a *Catch!* button during the call window; configurable penalty
- **Challenge Wild +4** — challenge an illegal +4 (offender draws the stack) or accept (draw stack; failed challenges cost stack +2)
- Win screen with official UNO scoring and full ranking

### Polish
- Three themes: **Classic UNO**, **Dark Mode**, **Modern** — plus synthesized sound effects (mutable) and card deal/play/UNO/win animations
- Fully responsive: desktop, tablets and phones (portrait & landscape)
- Custom avatars: pick an emoji or upload an image (resized client-side)

### Networking & security
- **Server-authoritative**: clients send intents only. The server validates turn order, card ownership, rule legality, stacking limits, challenge outcomes — everything
- Hidden information never leaves the server: each player receives a personalized sanitized state (opponents' hands are counts only; spectators see no hands)
- Identity = persistent `playerId` + secret token (anti-impersonation), per-socket **rate limiting**, payload size limits, sanitized chat/names
- **Reconnection & state recovery**: refresh the page or drop your connection and rejoin the running game with your hand intact
- Anti-desync: full state snapshots on every change, `game:requestState` recovery hook

### Stats & history
- Per-player JSON-persisted stats: games, wins, losses, win rate, cards played, cards drawn, UNO calls
- Match history with placements, duration and winners (`server/data/*.json`)

### AI bots
- **Easy** — random legal plays, often forgets to call UNO
- **Medium** — color strategy, attacks low-card opponents, usually calls UNO
- **Hard** — weighted card scoring, wild conservation, seven-zero swap tactics, challenges suspicious +4s, catches missed UNO calls

---

## Project structure

```
uno/
├── package.json            # root: installs everything, runs both apps
├── server/
│   ├── index.js            # Express + Socket.IO entry, auth, rate limiting
│   ├── lobbies.js          # lobby manager (create/join/kick/ready/chat/bots)
│   ├── stats.js            # JSON-persisted stats & match history
│   ├── data/               # created at runtime: stats.json, history.json
│   └── game/
│       ├── cards.js        # deck construction & shuffling
│       ├── rules.js        # rule defaults + sanitization
│       ├── engine.js       # server-authoritative game state machine
│       └── bots.js         # AI decision-making (3 difficulties)
└── client/
    ├── vite.config.ts      # dev proxy (:3000 → :3001), LAN host
    └── src/
        ├── store.tsx       # socket ↔ React state bridge
        ├── socket.ts       # identity auth, reconnection, ack helper
        ├── identity.ts     # persistent playerId/token/profile
        ├── sounds.ts       # Web Audio synthesized SFX
        └── components/     # Home, Lobby, Game, Cards, Chat, Rules, Stats
```

## Development

- `npm start` runs both with hot reload (Vite HMR for the client; restart the server process to pick up server changes).
- Server only: `npm run start --prefix server` · Client only: `npm run dev --prefix client`
- Tests: `npm test --prefix server` (engine simulation: 30 full bot games + security checks) · `npm run test:e2e --prefix server` (full socket flow — requires `npm start` running)
- REST endpoints: `GET /api/health`, `GET /api/stats/:playerId`, `GET /api/history/:playerId`, `GET /api/lobby/:code`

## How a game flows

1. Host creates a lobby → gets a code + invite link.
2. Friends join (or bots fill seats); non-hosts press **Ready**.
3. Host starts. Cards are dealt server-side; each client only ever sees its own hand.
4. Play proceeds with whatever house rules the host configured — stacking wars, hand swaps, jump-ins.
5. Don't forget to press **UNO!** at two cards — opponents (and sharp-eyed bots) will catch you.
6. First player to empty their hand wins; results are recorded to stats and match history, and everyone returns to the lobby for a rematch.

Enjoy! 🎉
