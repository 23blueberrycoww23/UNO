import type { Card, CardColor } from '../types';

const GLYPHS: Record<string, string> = {
  skip: '⊘',
  reverse: '⇄',
  draw2: '+2',
  wild: '✦',
  wild4: '+4'
};

export function cardLabel(card: Card): string {
  const names: Record<string, string> = {
    skip: 'Skip', reverse: 'Reverse', draw2: 'Draw Two', wild: 'Wild', wild4: 'Wild Draw Four'
  };
  const value = names[card.value] || card.value;
  return card.color === 'wild' ? value : `${card.color} ${value}`;
}

interface Props {
  card: Card;
  faceDown?: boolean;
  playable?: boolean;
  selected?: boolean;
  small?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  overlayColor?: CardColor | null; // shows chosen color on a played wild
}

export default function CardView({ card, faceDown, playable, selected, small, onClick, style, overlayColor }: Props) {
  if (faceDown) {
    return (
      <div className={`uno-card back ${small ? 'small' : ''}`} style={style} aria-hidden>
        <div className="card-inner-oval"><span>UNO</span></div>
      </div>
    );
  }

  const glyph = GLYPHS[card.value] ?? card.value;
  const isWild = card.color === 'wild';
  const cls = [
    'uno-card',
    `c-${card.color}`,
    playable ? 'playable' : '',
    selected ? 'selected' : '',
    small ? 'small' : '',
    onClick ? 'clickable' : ''
  ].join(' ');

  return (
    <button
      type="button"
      className={cls}
      style={style}
      onClick={onClick}
      disabled={!onClick}
      aria-label={cardLabel(card)}
      title={cardLabel(card)}
    >
      <span className="corner tl">{glyph}</span>
      {isWild ? (
        <div className="card-inner-oval wild-oval">
          <span className="wild-quad">
            <i className="q red" /><i className="q yellow" /><i className="q green" /><i className="q blue" />
          </span>
          <span className="wild-glyph">{glyph}</span>
        </div>
      ) : (
        <div className="card-inner-oval"><span className="big-glyph">{glyph}</span></div>
      )}
      <span className="corner br">{glyph}</span>
      {overlayColor && overlayColor !== 'wild' && <span className={`color-dot dot-${overlayColor}`} />}
    </button>
  );
}
