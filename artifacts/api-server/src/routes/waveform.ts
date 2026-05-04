import { Router, type IRouter } from "express";
import path from "path";
import { runScript } from "../lib/runScript";

const router: IRouter = Router();

const DETECT_SCRIPT = path.resolve(__dirname, "../../../scripts/generate_waveform.py");

/** Parse ISO 8601 duration string (PT3M45S) → seconds */
function parseIsoDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? "0") * 3600)
       + (parseInt(m[2] ?? "0") * 60)
       + parseFloat(m[3] ?? "0");
}

/** Get video duration from YouTube Data API (fast, no download needed). */
async function fetchYtDuration(videoId: string): Promise<number | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=contentDetails&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      items?: Array<{ contentDetails?: { duration?: string } }>;
    };
    const dur = data.items?.[0]?.contentDetails?.duration;
    return dur ? parseIsoDuration(dur) : null;
  } catch {
    return null;
  }
}

router.get("/waveform/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || !/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  // Run YouTube API duration fetch and audio download in parallel
  const [ytDuration, scriptResult] = await Promise.allSettled([
    fetchYtDuration(videoId),
    runScript<{ peaks: number[]; durationSec: number }>(DETECT_SCRIPT, videoId, 5),
  ]);

  if (scriptResult.status === "fulfilled") {
    res.json(scriptResult.value);
    return;
  }

  // Audio download failed — return empty peaks but with correct duration if we have it
  const dur = ytDuration.status === "fulfilled" ? ytDuration.value : null;
  if (dur && dur > 0) {
    req.log.warn({ videoId, err: (scriptResult as PromiseRejectedResult).reason },
      "waveform audio failed, returning duration-only");
    res.json({ peaks: [], durationSec: dur });
    return;
  }

  req.log.error({ err: (scriptResult as PromiseRejectedResult).reason }, "waveform failed");
  res.status(500).json({ error: ((scriptResult as PromiseRejectedResult).reason as Error).message });
});

export default router;
