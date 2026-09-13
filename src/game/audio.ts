// Tiny Web Audio SFX. Lazily created on first user gesture; silent-safe.

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function setMuted(v: boolean) {
  muted = v;
}

export function isMuted() {
  return muted;
}

/** unlock audio on first gesture */
export function primeAudio() {
  ac();
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.14, delay = 0) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function sfxDrop() {
  tone(220, 0.12, "sine", 0.1);
}

export function sfxLand() {
  tone(320, 0.09, "triangle", 0.12);
  tone(160, 0.14, "sine", 0.08, 0.01);
}

export function sfxPlace() {
  // pleasant little "ding" when a block settles well
  tone(660, 0.1, "sine", 0.1);
  tone(990, 0.12, "sine", 0.07, 0.04);
}

export function sfxWarn() {
  tone(140, 0.16, "sawtooth", 0.06);
}

export function sfxCollapse() {
  const a = ac();
  if (!a) return;
  // descending rumble
  for (let i = 0; i < 5; i++) {
    tone(200 - i * 28, 0.18, "sawtooth", 0.09, i * 0.05);
  }
}

export function sfxClear() {
  const notes = [523, 659, 784, 1046];
  notes.forEach((n, i) => tone(n, 0.22, "triangle", 0.12, i * 0.11));
}
