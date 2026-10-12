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

// Accidental after the note letter: ASCII b/# must be attached ("Ab", but not
// the "b" in "A but"); ♭/♯/flat/sharp may be spaced ("A ♭", "E flat").
const ACCIDENTAL_RE_SRC = String.raw`(?:[b#](?![a-ln-z])|\s*[♭♯]|[\s-]*(?:flat|sharp)\b)`;

/** Map a raw accidental ("b", "♭", "flat", "#", "♯", "sharp") to "b" / "#" / "". */
function normalizeAccidental(raw: string | undefined): string {
  const a = (raw ?? "").toLowerCase().replace(/[\s-]/g, "");
  if (a === "b" || a === "♭" || a === "flat") return "b";
  if (a === "#" || a === "♯" || a === "sharp") return "#";
  return "";
}

function normalizeKey(letter: string, accidental: string | undefined, rawMode: string): { note: string; mode: string } {
  const rawNote = letter.toUpperCase() + normalizeAccidental(accidental);
  const note = NOTE_ALIASES[rawNote.toLowerCase()] ?? rawNote;
  const mode = rawMode.toLowerCase().startsWith("min") || rawMode.toLowerCase() === "m" ? "Minor" : "Major";
  return { note, mode };
}

const KEYWORD_KEY_RE = new RegExp(
  String.raw`\bkey\s*[:/=]?\s*([A-Ga-g])(${ACCIDENTAL_RE_SRC})?\s*(major|minor|maj|min|m\b)?`,
  "i",
);

export function parseKeyFromText(text: string): { note: string; mode: string } | null {
  // Match: key[:/=]? <note><accidental>? <major|minor|maj|min>?
  const m = text.match(KEYWORD_KEY_RE);
  if (!m) return null;
  return normalizeKey(m[1], m[2], m[3] ?? "major");
}

// Type-beat producers overwhelmingly state BPM and key together with no
// keyword at all, e.g. "132 e major", "140 Gmin", "95 F#maj" — this is the
// single most common format in the wild, more common than the keyword-based
// patterns above. Matching both together (rather than separately) also
// avoids misreading an unrelated number elsewhere in the text as the BPM.
const BARE_BPM_KEY_RE = new RegExp(
  String.raw`\b(\d{2,3})\s+([A-Ga-g])(${ACCIDENTAL_RE_SRC})?\s*(major|minor|maj|min|m)\b`,
  "i",
);

function parseBareBpmKeyTag(
  text: string,
): { bpm: number | null; key: { note: string; mode: string } | null } | null {
  const m = text.match(BARE_BPM_KEY_RE);
  if (!m) return null;
  const bpm = parseInt(m[1], 10);
  if (bpm < 60 || bpm > 220) return null;
  return { bpm, key: normalizeKey(m[2], m[3], m[4]) };
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

    const bareTag = parseBareBpmKeyTag(description) ?? parseBareBpmKeyTag(title);

    return {
      bpm: bareTag?.bpm ?? parseBpmFromText(description) ?? parseBpmFromText(title),
      key: bareTag?.key ?? parseKeyFromText(description) ?? parseKeyFromText(title),
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
