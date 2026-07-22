import type { Rules } from '../types';

interface Props {
  rules: Rules;
  onChange?: (partial: Partial<Rules>) => void;
  readOnly?: boolean;
}

interface ToggleDef {
  key: keyof Rules;
  label: string;
  hint: string;
}

const OFFICIAL: ToggleDef[] = [
  { key: 'drawTwo', label: 'Draw Two', hint: 'Include +2 cards in the deck' },
  { key: 'reverse', label: 'Reverse', hint: 'Include Reverse cards in the deck' },
  { key: 'skip', label: 'Skip', hint: 'Include Skip cards in the deck' },
  { key: 'wild', label: 'Wild', hint: 'Include Wild cards in the deck' },
  { key: 'wildDrawFour', label: 'Wild Draw Four', hint: 'Include +4 cards in the deck' }
];

const HOUSE: ToggleDef[] = [
  { key: 'stackDraw2', label: 'Stack +2 on +2', hint: 'Pass the penalty along with another +2' },
  { key: 'stackDraw4', label: 'Stack +4 on +4', hint: 'Pass the penalty along with another +4' },
  { key: 'stackDraw4OnDraw2', label: 'Stack +4 on +2', hint: 'Escalate a +2 stack with a +4' },
  { key: 'sevenZero', label: 'Seven-Zero', hint: '7 swaps hands with a player, 0 rotates all hands' },
  { key: 'jumpIn', label: 'Jump-In', hint: 'Play an identical card instantly, even out of turn' },
  { key: 'forcePlay', label: 'Force Play', hint: 'A drawn playable card is played automatically' },
  { key: 'drawUntilPlayable', label: 'Draw Until Playable', hint: 'Keep drawing until you can play' },
  { key: 'challengeDrawFour', label: 'Challenge +4', hint: 'Next player may challenge an illegal +4' },
  { key: 'noBluffing', label: 'No Bluffing', hint: 'Server enforces the official +4 restriction' }
];

const NUMBERS: { key: keyof Rules; label: string; hint: string; min: number; max: number; step?: number }[] = [
  { key: 'startingCards', label: 'Starting cards', hint: 'Cards dealt to each player', min: 3, max: 12 },
  { key: 'turnTime', label: 'Turn timer (s)', hint: '0 disables the timer', min: 0, max: 120, step: 5 },
  { key: 'unoTime', label: 'UNO window (s)', hint: 'Time to call UNO before being caught', min: 2, max: 15 },
  { key: 'unoPenalty', label: 'UNO penalty', hint: 'Cards drawn when caught', min: 1, max: 8 },
  { key: 'stackLimit', label: 'Stack limit', hint: '0 = unlimited stacking', min: 0, max: 40, step: 2 }
];

export default function RulesEditor({ rules, onChange, readOnly }: Props) {
  const set = (partial: Partial<Rules>) => !readOnly && onChange?.(partial);

  const toggleRow = (def: ToggleDef) => (
    <label key={def.key} className={`rule-row ${readOnly ? 'readonly' : ''}`} title={def.hint}>
      <span className="rule-label">
        {def.label}
        <small>{def.hint}</small>
      </span>
      <input
        type="checkbox"
        checked={!!rules[def.key]}
        disabled={readOnly}
        onChange={(e) => set({ [def.key]: e.target.checked } as Partial<Rules>)}
      />
      <span className="switch" />
    </label>
  );

  return (
    <div className="rules-editor">
      <h4>Official cards</h4>
      {OFFICIAL.map(toggleRow)}

      <h4>House rules</h4>
      {HOUSE.map(toggleRow)}

      <h4>Tuning</h4>
      {NUMBERS.map((def) => (
        <label key={def.key} className="rule-row rule-num" title={def.hint}>
          <span className="rule-label">
            {def.label}
            <small>{def.hint}</small>
          </span>
          <input
            type="number"
            value={Number(rules[def.key])}
            min={def.min}
            max={def.max}
            step={def.step || 1}
            disabled={readOnly}
            onChange={(e) => set({ [def.key]: Number(e.target.value) } as Partial<Rules>)}
          />
        </label>
      ))}
    </div>
  );
}
