import { midiToNoteName, isBlackKey } from "../lib/pitch-detection";

interface PianoKeyboardProps {
  /** Inclusive MIDI range to render. */
  lowMidi: number;
  highMidi: number;
  /** The note the user is trying to match, if any. */
  targetMidi: number | null;
  /** The note currently detected from the mic, if listening. */
  liveMidi: number | null;
  onKeyPress: (midi: number) => void;
}

export function PianoKeyboard({ lowMidi, highMidi, targetMidi, liveMidi, onKeyPress }: PianoKeyboardProps) {
  const allMidis: number[] = [];
  for (let m = lowMidi; m <= highMidi; m++) allMidis.push(m);

  const whiteMidis = allMidis.filter((m) => !isBlackKey(m));
  const whiteWidthPct = 100 / whiteMidis.length;
  const blackWidthPct = whiteWidthPct * 0.62;

  const isMatch = targetMidi !== null && liveMidi === targetMidi;

  return (
    <div className="relative w-full h-28 select-none">
      {/* White keys */}
      <div className="absolute inset-0 flex">
        {whiteMidis.map((midi) => {
          const { note, octave } = midiToNoteName(midi);
          const isTarget = midi === targetMidi;
          return (
            <button
              key={midi}
              onClick={() => onKeyPress(midi)}
              style={{ width: `${whiteWidthPct}%` }}
              className={`relative h-full border-r border-border last:border-r-0 rounded-b-md transition-colors flex items-end justify-center pb-1.5 ${
                isTarget
                  ? isMatch
                    ? "bg-green-400/80"
                    : "bg-primary/60"
                  : "bg-white hover:bg-primary/10 active:bg-primary/20"
              }`}
            >
              {octave !== undefined && note === "C" && (
                <span className={`text-[9px] font-mono ${isTarget ? "text-white" : "text-text-muted/60"}`}>
                  C{octave}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Black keys, absolutely positioned at the boundary between the white
          key they follow and the next one */}
      <div className="absolute inset-0 pointer-events-none">
        {allMidis.map((midi) => {
          if (!isBlackKey(midi)) return null;
          const whiteIndexBefore = whiteMidis.filter((m) => m < midi).length - 1;
          const leftPct = (whiteIndexBefore + 1) * whiteWidthPct - blackWidthPct / 2;
          const isTarget = midi === targetMidi;
          return (
            <button
              key={midi}
              onClick={() => onKeyPress(midi)}
              style={{ left: `${leftPct}%`, width: `${blackWidthPct}%` }}
              className={`absolute top-0 h-[62%] rounded-b-md pointer-events-auto transition-colors ${
                isTarget
                  ? isMatch
                    ? "bg-green-500"
                    : "bg-primary"
                  : "bg-neutral-900 hover:bg-neutral-700 active:bg-neutral-600"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
