import { Router, type IRouter } from "express";
import path from "path";
import { runScript } from "../lib/runScript";

const router: IRouter = Router();

const DETECT_SCRIPT = path.resolve(__dirname, "../../../scripts/detect_key.py");

// Note enharmonic equivalents so "Bb" and "A#" both map cleanly
const NOTE_ALIASES: Record<string, string> = {
  "a#": "Bb", "bb": "Bb",
  "c#": "C#", "db": "Db",
  "d#": "D#", "eb": "Eb",
  "f#": "F#", "gb": "Gb",
  "g#": "G#", "ab": "Ab",
};

/** Parse "Key: Bb major" / "key = F# minor" / "Key: Am" from text. */
function keyFromText(text: string): { note: string; mode: string } | null {
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

/** Try to get key from YouTube video metadata (title + description). */
async function keyFromMetadata(videoId: string): Promise<{ note: string; mode: string } | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      items?: Array<{ snippet?: { title?: string; description?: string } }>;
    };
    const item = data.items?.[0]?.snippet;
    if (!item) return null;

    // Try description first (more likely to have explicit key label), then title
    return keyFromText(item.description ?? "") ?? keyFromText(item.title ?? "");
  } catch {
    return null;
  }
}

router.get("/detect-key/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || !/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  // 1. Fast path: parse key from YouTube metadata
  const metaKey = await keyFromMetadata(videoId);
  if (metaKey) {
    req.log.info({ videoId, key: `${metaKey.note} ${metaKey.mode}`, source: "metadata" }, "key from metadata");
    res.json(metaKey);
    return;
  }

  // 2. Slow path: Essentia audio analysis
  try {
    const result = await runScript<{ note: string; mode: string }>(DETECT_SCRIPT, videoId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "detect-key failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
