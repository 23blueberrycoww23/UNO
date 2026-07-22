// Synthesized sound effects via the Web Audio API — no audio assets needed.

let ctx: AudioContext | null = null;
let muted = localStorage.getItem('uno.muted') === '1';

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  localStorage.setItem('uno.muted', value ? '1' : '0');
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'sine', gainValue = 0.12) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, ac.currentTime + start);
  gain.gain.linearRampToValueAtTime(gainValue, ac.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + duration + 0.05);
}

export const sounds = {
  play() {
    tone(520, 0, 0.09, 'triangle', 0.15);
    tone(700, 0.04, 0.08, 'triangle', 0.1);
  },
  draw() {
    tone(300, 0, 0.06, 'sawtooth', 0.07);
    tone(240, 0.05, 0.07, 'sawtooth', 0.06);
  },
  uno() {
    tone(660, 0, 0.12, 'square', 0.1);
    tone(880, 0.1, 0.12, 'square', 0.1);
    tone(1100, 0.2, 0.18, 'square', 0.12);
  },
  caught() {
    tone(330, 0, 0.15, 'sawtooth', 0.12);
    tone(220, 0.13, 0.25, 'sawtooth', 0.12);
  },
  penalty() {
    tone(200, 0, 0.12, 'square', 0.09);
    tone(160, 0.1, 0.18, 'square', 0.09);
  },
  turn() {
    tone(880, 0, 0.08, 'sine', 0.08);
  },
  victory() {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((n, i) => tone(n, i * 0.14, 0.22, 'triangle', 0.14));
  },
  defeat() {
    tone(440, 0, 0.2, 'sine', 0.1);
    tone(370, 0.18, 0.2, 'sine', 0.1);
    tone(294, 0.36, 0.35, 'sine', 0.1);
  },
  shuffle() {
    for (let i = 0; i < 6; i++) tone(150 + Math.random() * 250, i * 0.035, 0.04, 'sawtooth', 0.04);
  }
};
