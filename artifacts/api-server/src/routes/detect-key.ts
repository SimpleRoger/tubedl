import { Router, type IRouter } from "express";
import path from "path";
import { runScript } from "../lib/runScript";
import { fetchTagsFromMetadata } from "../lib/audio-analysis";

const router: IRouter = Router();

const DETECT_SCRIPT = path.resolve(__dirname, "../../../scripts/detect_key.py");

router.get("/detect-key/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || !/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  // 1. Fast path: parse key from video description (checked first), then title
  const { key: metaKey } = await fetchTagsFromMetadata(videoId);
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
