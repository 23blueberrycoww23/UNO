// Quick engine smoke test: runs full bot-only games with aggressive house
// rules enabled and verifies card conservation and termination.
// Usage: node test-engine.mjs

import { UnoGame } from './game/engine.js';
import { sanitizeRules } from './game/rules.js';

let failures = 0;

function runGame(i, rulesOverride) {
  const rules = sanitizeRules({
    stackDraw2: true, stackDraw4: true, stackDraw4OnDraw2: true,
    sevenZero: true, jumpIn: true, challengeDrawFour: true,
    turnTime: 0, ...rulesOverride
  });
  const players = ['A', 'B', 'C', 'D'].map((n, idx) => ({
    id: 'p' + idx, name: n, isBot: true,
    difficulty: ['easy', 'medium', 'hard'][idx % 3]
  }));
  let finished = null;
  const game = new UnoGame({
    players, rules,
    onUpdate: () => {},
    onEvent: () => {},
    onFinish: (r) => { finished = r; }
  });
  game.start();

  // Drive bot turns synchronously instead of waiting for timers.
  let safety = 0;
  while (!game.finished && safety < 5000) {
    clearTimeout(game._timers.bot);
    game.botAct();
    safety++;
    // card conservation check
    const total = game.drawPile.length + game.discard.length +
      game.players.reduce((s, p) => s + p.hand.length, 0);
    if (total !== gameCardTotal) {
      console.error(`Game ${i}: card count drifted to ${total} (expected ${gameCardTotal})`);
      failures++;
      break;
    }
  }
  game.destroy();
  if (!game.finished) {
    console.error(`Game ${i}: did not finish after ${safety} actions`);
    failures++;
  } else if (!finished || !finished.ranking || finished.ranking.length !== 4) {
    console.error(`Game ${i}: bad results payload`);
    failures++;
  }
  return safety;
}

// Establish expected card total from a fresh game
import { buildDeck } from './game/cards.js';
const gameCardTotal = buildDeck(sanitizeRules({})).length; // 108

let totalActions = 0;
for (let i = 0; i < 30; i++) {
  totalActions += runGame(i, i % 2 === 0 ? {} : { drawUntilPlayable: true, forcePlay: true, noBluffing: true });
}

// Security spot-checks
const g = new UnoGame({
  players: [{ id: 'h1', name: 'Human' }, { id: 'h2', name: 'Other' }],
  rules: sanitizeRules({ turnTime: 0 }),
  onUpdate: () => {}, onEvent: () => {}, onFinish: () => {}
});
g.start();
const current = g.currentPlayer();
const other = g.players.find((p) => p.id !== current.id);

let r = g.handlePlay(current.id, { cardId: other.hand[0].id });
if (r.ok) { console.error('SECURITY: played a card the player does not own'); failures++; }

r = g.handlePlay(other.id, { cardId: other.hand[0].id });
if (r.ok && !g.rules.jumpIn) { console.error('SECURITY: played out of turn'); failures++; }

r = g.handleDraw(other.id);
if (r.ok) { console.error('SECURITY: drew out of turn'); failures++; }

const snapshot = g.stateFor(current.id);
if (snapshot.players.some((p) => 'hand' in p)) { console.error('SECURITY: hand leaked in snapshot'); failures++; }
if (snapshot.yourHand.length !== current.hand.length) { console.error('snapshot hand mismatch'); failures++; }
g.destroy();

if (failures === 0) {
  console.log(`OK: 30 full games completed (${totalActions} bot actions), card conservation held, security checks passed.`);
  process.exit(0);
} else {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
