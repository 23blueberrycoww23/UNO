// Card definitions and deck construction for UNO.

export const COLORS = ['red', 'yellow', 'green', 'blue'];

let nextCardId = 1;

function makeCard(color, value) {
  return { id: 'c' + nextCardId++, color, value };
}

/**
 * Fisher-Yates shuffle (in place).
 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Builds an official 108-card UNO deck, honoring rule toggles that
 * disable specific action cards.
 *
 * Per color: one 0, two each of 1-9, two Skip, two Reverse, two Draw Two.
 * Plus four Wild and four Wild Draw Four.
 */
export function buildDeck(rules) {
  const deck = [];
  for (const color of COLORS) {
    deck.push(makeCard(color, '0'));
    for (let n = 1; n <= 9; n++) {
      deck.push(makeCard(color, String(n)), makeCard(color, String(n)));
    }
    if (rules.skip) deck.push(makeCard(color, 'skip'), makeCard(color, 'skip'));
    if (rules.reverse) deck.push(makeCard(color, 'reverse'), makeCard(color, 'reverse'));
    if (rules.drawTwo) deck.push(makeCard(color, 'draw2'), makeCard(color, 'draw2'));
  }
  if (rules.wild) for (let i = 0; i < 4; i++) deck.push(makeCard('wild', 'wild'));
  if (rules.wildDrawFour) for (let i = 0; i < 4; i++) deck.push(makeCard('wild', 'wild4'));
  return shuffle(deck);
}

/** Official UNO scoring value of a card. */
export function cardPoints(card) {
  if (card.value === 'wild' || card.value === 'wild4') return 50;
  if (card.value === 'skip' || card.value === 'reverse' || card.value === 'draw2') return 20;
  return parseInt(card.value, 10);
}

export function isActionValue(value) {
  return ['skip', 'reverse', 'draw2', 'wild', 'wild4'].includes(value);
}
