import { Router, type IRouter } from "express";
import path from "path";
import { runScript } from "../lib/runScript";

const router: IRouter = Router();

const DETECT_SCRIPT = path.resolve(__dirname, "../../../scripts/detect_bpm.py");

/** Parse BPM from a video title or description string, e.g. "140 BPM", "bpm: 120", "@ 95bpm" */
function parseBpmFromText(text: string): number | null {
  const patterns = [
    /\b(\d{2,3})\s*bpm\b/i,           // "140 BPM"  or  "140bpm"
    /\bbpm[:\s]+(\d{2,3})\b/i,         // "BPM: 140"  or  "bpm 140"
    /\bat\s+(\d{2,3})\s*bpm\b/i,       // "at 140 bpm"
    /[@#]\s*(\d{2,3})\s*bpm\b/i,       // "@140bpm"  "#140bpm"
    /\b(\d{2,3})\s*beats?\s+per\s+min/i, // "140 beats per min"
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const bpm = parseInt(m[1], 10);
      if (bpm >= 60 && bpm <= 220) return bpm;
    }
  }
  return null;
}

/** Try to get BPM from YouTube video metadata (title + description). */
async function bpmFromMetadata(videoId: string): Promise<number | null> {
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

    const combined = `${item.title ?? ""} ${item.description ?? ""}`;
    return parseBpmFromText(combined);
  } catch {
    return null;
  }
}

router.get("/detect-bpm/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || !/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  // 1. Fast path: parse BPM from video title/description via YouTube Data API
  const metaBpm = await bpmFromMetadata(videoId);
  if (metaBpm) {
    req.log.info({ videoId, bpm: metaBpm, source: "metadata" }, "BPM from metadata");
    res.json({ bpm: metaBpm });
    return;
  }

  // 2. Slow path: download audio and run onset-autocorrelation analysis
  try {
    const result = await runScript<{ bpm: number }>(DETECT_SCRIPT, videoId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "detect-bpm failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
