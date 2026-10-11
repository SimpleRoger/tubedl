import { Router, type IRouter } from "express";
import path from "path";
import { runScript } from "../lib/runScript";
import { fetchTagsFromMetadata } from "../lib/audio-analysis";

const router: IRouter = Router();

const DETECT_SCRIPT = path.resolve(__dirname, "../../../scripts/detect_bpm.py");

router.get("/detect-bpm/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || !/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  // 1. Fast path: parse BPM from video description (checked first — most
  // accurate when the creator states it themselves), then title
  const { bpm: metaBpm } = await fetchTagsFromMetadata(videoId);
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
