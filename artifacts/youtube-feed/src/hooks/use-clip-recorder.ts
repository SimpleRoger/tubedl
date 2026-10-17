import { useCallback, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";

export interface SingingRating {
  score: number | null;
  pitch: string;
  feedback: string;
  raw: string;
}

export function useClipRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isRating, setIsRating] = useState(false);
  const [rating, setRating] = useState<SingingRating | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback((stream: MediaStream) => {
    setError(null);
    setRating(null);
    chunksRef.current = [];

    const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    );
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.start();
    recorderRef.current = recorder;
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        setIsRecording(false);
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setIsRecording(false);
        resolve(blob.size > 0 ? blob : null);
      };
      recorder.stop();
    });
  }, []);

  const rateClip = useCallback(async (blob: Blob) => {
    setIsRating(true);
    setError(null);
    try {
      const result = await customFetch<SingingRating>("/api/sing-rating", {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      setRating(result);
    } catch (err: any) {
      setError(err?.message ?? "Couldn't rate that clip");
    } finally {
      setIsRating(false);
    }
  }, []);

  return { isRecording, isRating, rating, error, startRecording, stopRecording, rateClip };
}
