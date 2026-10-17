let sharedCtx: AudioContext | null = null;
let activeOscillator: OscillatorNode | null = null;

function getContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === "closed") sharedCtx = new AudioContext();
  return sharedCtx;
}

/** Plays a short reference tone at the given frequency, stopping any previous one first. */
export function playTone(frequency: number, durationSec = 1.2): void {
  const ctx = getContext();
  if (ctx.state === "suspended") ctx.resume();

  activeOscillator?.stop();
  activeOscillator = null;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;

  const now = ctx.currentTime;
  // Quick fade in/out avoids an audible click at start/stop
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.25, now + 0.02);
  gain.gain.setValueAtTime(0.25, now + durationSec - 0.05);
  gain.gain.linearRampToValueAtTime(0, now + durationSec);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec);
  activeOscillator = osc;
  osc.onended = () => { if (activeOscillator === osc) activeOscillator = null; };
}

export function stopTone(): void {
  activeOscillator?.stop();
  activeOscillator = null;
}
