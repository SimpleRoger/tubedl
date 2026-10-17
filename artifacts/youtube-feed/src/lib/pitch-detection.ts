// Autocorrelation-based pitch detector — same family of algorithm as a
// classic guitar tuner. Runs entirely client-side on mic input, no server
// round-trip (needed for anything to feel "live" while singing).

/** Returns the detected fundamental frequency in Hz, or -1 if too quiet/unclear. */
export function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const SIZE = buf.length;

  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1; // silence / background noise only

  // Trim near-zero samples at the edges so the correlation window is
  // centered on actual signal, not whatever silence padding surrounds it.
  const thres = 0.2;
  let r1 = 0;
  let r2 = SIZE - 1;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  }

  const trimmed = buf.slice(r1, r2);
  const n = trimmed.length;
  if (n < 2) return -1;

  const c = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag];
    c[lag] = sum;
  }

  // Skip the initial downslope from lag 0 (always the strongest, but
  // meaningless — it's the signal correlated with itself at zero offset).
  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;

  let maxVal = -Infinity;
  let maxPos = -1;
  for (let i = d; i < n; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos <= 0) return -1;

  // Parabolic interpolation around the peak for sub-sample precision —
  // without this, pitch readings jump in whole-sample (several-cent) steps.
  const x1 = c[maxPos - 1] ?? c[maxPos];
  const x2 = c[maxPos];
  const x3 = c[maxPos + 1] ?? c[maxPos];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const T0 = a !== 0 ? maxPos - b / (2 * a) : maxPos;

  if (T0 <= 0) return -1;
  return sampleRate / T0;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface NoteInfo {
  note: string;
  octave: number;
  /** Cents sharp (+) or flat (-) relative to the nearest note, range ~[-50, 50]. */
  cents: number;
  midi: number;
}

/** A4 = 440Hz = MIDI 69, standard concert pitch. */
export function frequencyToNote(freq: number): NoteInfo {
  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { note, octave, cents, midi };
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi: number): { note: string; octave: number } {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { note, octave };
}

export function isBlackKey(midi: number): boolean {
  return NOTE_NAMES[((midi % 12) + 12) % 12].includes("#");
}
