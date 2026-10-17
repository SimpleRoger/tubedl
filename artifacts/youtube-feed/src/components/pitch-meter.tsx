import { motion } from "framer-motion";
import type { PitchReading } from "../hooks/use-pitch-detection";

export function PitchMeter({ pitch }: { pitch: PitchReading | null }) {
  const cents = pitch?.cents ?? 0;
  // -50..+50 cents -> 0..100% across the meter
  const needlePct = 50 + cents;

  const color = !pitch
    ? "bg-text-muted"
    : Math.abs(cents) <= 10
    ? "bg-green-400"
    : Math.abs(cents) <= 25
    ? "bg-amber-400"
    : "bg-red-400";

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="flex items-baseline gap-1 h-20">
        {pitch ? (
          <>
            <span className="text-6xl font-display font-bold text-text-main tabular-nums">
              {pitch.note}
            </span>
            <span className="text-2xl font-display font-bold text-text-muted">{pitch.octave}</span>
          </>
        ) : (
          <span className="text-2xl font-semibold text-text-muted">Sing something…</span>
        )}
      </div>

      <div className="w-full max-w-sm">
        <div className="relative h-2.5 rounded-full bg-surface-hover border border-border overflow-hidden">
          {/* Center "in tune" marker */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-hover" />
          <motion.div
            className={`absolute top-0 bottom-0 w-2 rounded-full ${color}`}
            animate={{ left: `calc(${Math.min(100, Math.max(0, needlePct))}% - 4px)` }}
            transition={{ duration: 0.08 }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-text-muted mt-1 font-mono">
          <span>flat</span>
          <span>in tune</span>
          <span>sharp</span>
        </div>
      </div>

      {pitch && (
        <p className="text-xs text-text-muted font-mono">
          {pitch.frequency.toFixed(1)} Hz · {pitch.cents > 0 ? "+" : ""}{pitch.cents}¢
        </p>
      )}
    </div>
  );
}
