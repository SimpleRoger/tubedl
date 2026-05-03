import { Router, type IRouter } from "express";
import path from "path";
import { runScript } from "../lib/runScript";

const router: IRouter = Router();

const DETECT_SCRIPT = path.resolve(__dirname, "../../../scripts/detect_key.py");

router.get("/detect-key/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || !/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  try {
    const result = await runScript<{ note: string; mode: string }>(DETECT_SCRIPT, videoId);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "detect-key failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
