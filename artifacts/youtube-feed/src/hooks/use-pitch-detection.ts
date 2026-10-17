import { useCallback, useRef, useState } from "react";
import { autoCorrelate, frequencyToNote, type NoteInfo } from "../lib/pitch-detection";

export interface PitchReading extends NoteInfo {
  frequency: number;
}

export function usePitchDetection() {
  const [pitch, setPitch] = useState<PitchReading | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    setIsListening(false);
    setPitch(null);
    setStream(null);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      setStream(stream);

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        const freq = autoCorrelate(buf, audioCtx.sampleRate);
        setPitch(freq > 0 ? { frequency: freq, ...frequencyToNote(freq) } : null);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      setIsListening(true);
    } catch (err: any) {
      setError(
        err?.name === "NotAllowedError"
          ? "Microphone access denied — allow it in your browser's site settings to use this."
          : err?.message ?? "Couldn't access the microphone",
      );
    }
  }, []);

  return { start, stop, pitch, isListening, error, stream };
}
