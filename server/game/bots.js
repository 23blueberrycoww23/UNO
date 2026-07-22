// Bot AI for UNO with three difficulty levels.
//
// Bots act through the exact same validated engine entry points as human
// players — they get no special powers, only decisions.

import { COLORS, cardPoints } from './cards.js';

const rand = (n) => Math.floor(Math.random() * n);
const chance = (p) => Math.random() < p;

export function botUnoDeclareChance(difficulty) {
  return { easy: 0.55, medium: 0.9, hard: 1 }[difficulty] ?? 0.9;
}

export function botCatchChance(difficulty) {
  return { easy: 0.1, medium: 0.45, hard: 0.85 }[difficulty] ?? 0.4;
}

/** Most common color in a hand (for wild color choice). Falls back to random. */
function bestColor(hand) {
  const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const c of hand) if (c.color !== 'wild') counts[c.color]++;
  const sorted = COLORS.slice().sort((a, b) => counts[b] - counts[a]);
  if (counts[sorted[0]] === 0) return COLORS[rand(4)];
  return sorted[0];
}

/** Decide whether to challenge a Wild Draw Four. */
export function decideChallenge(game, bot) {
  const offender = game.players.find((p) => p.id === game.challenge.offenderId);
  const offenderCards = offender ? offender.hand.length : 7;
  switch (bot.difficulty) {
    case 'easy': return false;
    case 'medium': return chance(0.2);
    case 'hard':
      // More likely to challenge if the offender kept a big hand (suggests
      // they had other options) and the stakes are high.
      return chance(Math.min(0.65, 0.15 + offenderCards * 0.05 + game.pendingDraw * 0.03));
    default: return false;
  }
}

/** Pick a swap target when playing a 7 under seven-zero rules. */
function pickSwapTarget(game, bot) {
  const others = game.players.filter((p) => p.id !== bot.id);
  if (bot.difficulty === 'easy') return others[rand(others.length)].id;
  // Take the smallest hand (only beneficial if smaller than ours, but a 7
  // must swap, so smallest is always the right call).
  return others.slice().sort((a, b) => a.hand.length - b.hand.length)[0].id;
}

/**
 * Main decision: returns one of
 *  { action: 'play', cardId, color?, swapTargetId?, declareUno? }
 *  { action: 'draw' }
 *  { action: 'pass' }
 *  { action: 'challenge', accept: boolean }
 */
export function decideBotTurn(game, bot) {
  // Pending Wild Draw Four challenge aimed at this bot
  if (game.challenge && game.challenge.victimId === bot.id) {
    // First see if we can stack our way out of it.
    const stackable = bot.hand.filter((c) => game.canPlay(bot, c));
    if (stackable.length > 0 && bot.difficulty !== 'easy') {
      return buildPlay(game, bot, stackable[0]);
    }
    if (decideChallenge(game, bot)) return { action: 'challenge', accept: true };
    return { action: 'challenge', accept: false };
  }

  // After drawing a playable card (no force-play): play it or pass
  if (game.pendingDrawnCardId) {
    const drawn = bot.hand.find((c) => c.id === game.pendingDrawnCardId);
    if (drawn && game.canPlay(bot, drawn)) {
      // Hard bots occasionally hold a wild4 drawn early; everyone else plays.
      return buildPlay(game, bot, drawn);
    }
    return { action: 'pass' };
  }

  const playable = bot.hand.filter((c) => game.canPlay(bot, c));
  if (playable.length === 0) return { action: 'draw' };

  let card;
  switch (bot.difficulty) {
    case 'easy':
      card = playable[rand(playable.length)];
      break;
    case 'medium':
      card = pickMedium(game, bot, playable);
      break;
    case 'hard':
    default:
      card = pickHard(game, bot, playable);
      break;
  }
  return buildPlay(game, bot, card);
}

function buildPlay(game, bot, card) {
  const move = { action: 'play', cardId: card.id };
  if (card.color === 'wild') move.color = bestColor(bot.hand.filter((c) => c.id !== card.id));
  if (game.rules.sevenZero && card.value === '7') move.swapTargetId = pickSwapTarget(game, bot);
  if (bot.hand.length === 2) {
    move.declareUno = chance(botUnoDeclareChance(bot.difficulty));
  }
  return move;
}

/** Medium: prefer non-wilds, prefer dominant color, punish low opponents. */
function pickMedium(game, bot, playable) {
  const next = game.players[game.nextIndex()];
  const nextLow = next && next.id !== bot.id && next.hand.length <= 2;

  if (nextLow) {
    const attack = playable.find((c) => ['draw2', 'wild4', 'skip', 'reverse'].includes(c.value));
    if (attack) return attack;
  }
  const nonWild = playable.filter((c) => c.color !== 'wild');
  if (nonWild.length > 0) {
    const fav = bestColor(bot.hand);
    const favCards = nonWild.filter((c) => c.color === fav);
    const pool = favCards.length > 0 ? favCards : nonWild;
    return pool[rand(pool.length)];
  }
  return playable[0];
}

/** Hard: weighted scoring of every playable card. */
function pickHard(game, bot, playable) {
  const next = game.players[game.nextIndex()];
  const colorCounts = Object.fromEntries(COLORS.map((c) => [c, 0]));
  for (const c of bot.hand) if (c.color !== 'wild') colorCounts[c.color]++;

  let best = null;
  let bestScore = -Infinity;
  for (const card of playable) {
    let score = 0;
    // Shed high-point cards early to limit loss if someone else wins.
    score += cardPoints(card) * 0.15;
    // Keep wilds as a safety net unless the hand is small or we must attack.
    if (card.color === 'wild') score -= 18;
    if (card.value === 'wild4') score -= 6;
    // Playing into our dominant color keeps future options open.
    if (card.color !== 'wild') score += colorCounts[card.color] * 2.5;
    // Punish a nearly-finished next player.
    if (next && next.hand.length <= 2) {
      if (card.value === 'draw2') score += 30;
      if (card.value === 'wild4') score += 38;
      if (card.value === 'skip') score += 24;
      if (card.value === 'reverse' && game.players.length > 2) score += 20;
    }
    // Seven-zero: a 7 is great when someone has fewer cards than us.
    if (game.rules.sevenZero && card.value === '7') {
      const smallest = Math.min(...game.players.filter((p) => p.id !== bot.id).map((p) => p.hand.length));
      score += (bot.hand.length - smallest) * 6;
    }
    if (game.rules.sevenZero && card.value === '0') {
      const dirNeighbor = game.players[game.nextIndex()];
      if (dirNeighbor && dirNeighbor.hand.length < bot.hand.length) score += 12;
    }
    // When we're down to 2 cards, dump action cards to deny counter-play.
    if (bot.hand.length <= 2) score += cardPoints(card) * 0.3;
    score += Math.random() * 3; // tie-break jitter
    if (score > bestScore) { bestScore = score; best = card; }
  }
  return best || playable[0];
}
