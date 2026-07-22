// Game rule configuration: defaults, validation and sanitization.
// The server NEVER trusts client-provided rule objects — everything is
// whitelisted and clamped here.

export const DEFAULT_RULES = {
  // Official card toggles
  drawTwo: true,
  reverse: true,
  skip: true,
  wild: true,
  wildDrawFour: true,

  // Stacking / progressive draw rules
  stackDraw2: false,        // +2 on +2
  stackDraw4: false,        // +4 on +4
  stackDraw4OnDraw2: false, // +4 on +2
  stackLimit: 0,            // 0 = unlimited stack

  // House rules
  sevenZero: false,         // 7 = swap hands, 0 = rotate hands
  jumpIn: false,            // play identical card out of turn
  forcePlay: false,         // drawn playable card is auto-played
  drawUntilPlayable: false, // keep drawing until a playable card appears
  challengeDrawFour: true,  // next player may challenge a Wild Draw Four
  noBluffing: false,        // server enforces the official +4 restriction

  // Tunables
  startingCards: 7,         // 3 - 12
  turnTime: 30,             // seconds, 0 = no timer (5 - 120)
  unoTime: 5,               // seconds to call UNO / be caught (2 - 15)
  unoPenalty: 2             // cards drawn when caught without calling UNO (1 - 8)
};

const BOOL_KEYS = [
  'drawTwo', 'reverse', 'skip', 'wild', 'wildDrawFour',
  'stackDraw2', 'stackDraw4', 'stackDraw4OnDraw2',
  'sevenZero', 'jumpIn', 'forcePlay', 'drawUntilPlayable',
  'challengeDrawFour', 'noBluffing'
];

const NUM_KEYS = {
  stackLimit: { min: 0, max: 40 },
  startingCards: { min: 3, max: 12 },
  turnTime: { min: 0, max: 120 },
  unoTime: { min: 2, max: 15 },
  unoPenalty: { min: 1, max: 8 }
};

/**
 * Returns a fully-populated, safe rules object built from untrusted input.
 */
export function sanitizeRules(input) {
  const rules = { ...DEFAULT_RULES };
  if (!input || typeof input !== 'object') return rules;

  for (const key of BOOL_KEYS) {
    if (typeof input[key] === 'boolean') rules[key] = input[key];
  }
  for (const [key, range] of Object.entries(NUM_KEYS)) {
    const v = Number(input[key]);
    if (Number.isFinite(v)) {
      rules[key] = Math.max(range.min, Math.min(range.max, Math.round(v)));
    }
  }
  // turnTime of 1-4 seconds is unplayable; snap up
  if (rules.turnTime > 0 && rules.turnTime < 5) rules.turnTime = 5;
  // noBluffing makes challenges meaningless (a +4 can never be illegal)
  if (rules.noBluffing) rules.challengeDrawFour = false;
  return rules;
}
