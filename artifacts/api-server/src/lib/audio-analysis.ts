import { spawn } from "child_process";
import path from "path";
import { getPythonBin, getFfmpegBin } from "./ytdlp";

const ANALYZE_SCRIPT = path.resolve(__dirname, "../../../scripts/analyze_audio.py");

export interface AudioAnalysis {
  bpm: number | null;
  key: { note: string; mode: string; strength?: number } | null;
}

/**
 * Detects BPM + musical key of a LOCAL audio/video file already on disk —
 * no extra download, unlike detect-bpm.ts/detect-key.ts which fetch their
 * own copy via yt-dlp. Never throws: analysis is a nice-to-have for the
 * download filename, not something that should ever fail a download.
 */
export function analyzeAudioFile(filePath: string, timeoutMs = 20_000): Promise<AudioAnalysis> {
  return new Promise((resolve) => {
    const child = spawn(getPythonBin(), [ANALYZE_SCRIPT, filePath, getFfmpegBin() || "ffmpeg"]);
    const out: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ bpm: null, key: null });
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ bpm: null, key: null });
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(Buffer.concat(out).toString().trim());
        resolve({ bpm: parsed.bpm ?? null, key: parsed.key ?? null });
      } catch {
        resolve({ bpm: null, key: null });
      }
    });
  });
}

/** "C#" -> "csharp", lowercased, for cross-platform-safe filenames. */
function sanitizeNote(note: string): string {
  return note.toLowerCase().replace("#", "sharp");
}

/** e.g. "183bpm_emajor_" — prepended to a download's filename when available. */
export function filenamePrefix(analysis: AudioAnalysis): string {
  const parts: string[] = [];
  if (analysis.bpm) parts.push(`${analysis.bpm}bpm`);
  if (analysis.key) parts.push(`${sanitizeNote(analysis.key.note)}${analysis.key.mode.toLowerCase()}`);
  return parts.length ? `${parts.join("_")}_` : "";
}
