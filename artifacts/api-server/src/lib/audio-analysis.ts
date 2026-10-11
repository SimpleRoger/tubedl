import { spawn } from "child_process";
import path from "path";
import { getPythonBin, getFfmpegBin } from "./ytdlp";
import { fetchVideoById } from "./youtube";

const ANALYZE_SCRIPT = path.resolve(__dirname, "../../../scripts/analyze_audio.py");

export interface AudioAnalysis {
  bpm: number | null;
  key: { note: string; mode: string; strength?: number } | null;
}

// ── Metadata text parsing ────────────────────────────────────────────────────
// Creators often state the exact BPM/key in the video description (sample
// packs, beat channels, etc.) — when present this is more accurate than
// audio analysis, so it's always checked first.

const BPM_PATTERNS = [
  /\btempo[:\s]+(\d{2,3})\b/i,         // "Tempo: 110"  or  "tempo 110"
  /\b(\d{2,3})\s*bpm\b/i,              // "140 BPM"  or  "140bpm"
  /\bbpm[:\s]+(\d{2,3})\b/i,           // "BPM: 140"  or  "bpm 140"
  /\bat\s+(\d{2,3})\s*bpm\b/i,         // "at 140 bpm"
  /[@#]\s*(\d{2,3})\s*bpm\b/i,         // "@140bpm"  "#140bpm"
  /\b(\d{2,3})\s*beats?\s+per\s+min/i, // "140 beats per min"
];

export function parseBpmFromText(text: string): number | null {
  for (const re of BPM_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const bpm = parseInt(m[1], 10);
      if (bpm >= 60 && bpm <= 220) return bpm;
    }
  }
  return null;
}

// Note enharmonic equivalents so "Bb" and "A#" both map cleanly
const NOTE_ALIASES: Record<string, string> = {
  "a#": "Bb", "bb": "Bb",
  "c#": "C#", "db": "Db",
  "d#": "D#", "eb": "Eb",
  "f#": "F#", "gb": "Gb",
  "g#": "G#", "ab": "Ab",
};

export function parseKeyFromText(text: string): { note: string; mode: string } | null {
  // Match: key[:/=]? <note><accidental>? <major|minor|maj|min>?
  const re = /\bkey\s*[:/=]?\s*([A-Ga-g][b#]?)\s*(major|minor|maj|min|m\b)?/i;
  const m = text.match(re);
  if (!m) return null;
  const rawNote = m[1];
  const rawMode = (m[2] ?? "major").toLowerCase();
  const note = NOTE_ALIASES[rawNote.toLowerCase()] ?? rawNote.charAt(0).toUpperCase() + rawNote.slice(1);
  const mode = rawMode.startsWith("min") || rawMode === "m" ? "Minor" : "Major";
  return { note, mode };
}

/**
 * Checks the video's description first, then its title, for an explicit
 * BPM/key the creator stated themselves — one YouTube API call covers both.
 * Returns whatever it finds; callers fall back to audio analysis for
 * whichever field (if any) comes back null.
 */
export async function fetchTagsFromMetadata(
  videoId: string,
): Promise<{ bpm: number | null; key: { note: string; mode: string } | null }> {
  try {
    const video = await fetchVideoById(videoId);
    if (!video) return { bpm: null, key: null };

    const description = video.description ?? "";
    const title = video.title ?? "";

    return {
      bpm: parseBpmFromText(description) ?? parseBpmFromText(title),
      key: parseKeyFromText(description) ?? parseKeyFromText(title),
    };
  } catch {
    return { bpm: null, key: null };
  }
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
