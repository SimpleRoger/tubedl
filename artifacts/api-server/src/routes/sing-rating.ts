import express, { Router, type IRouter, type Request, type Response } from "express";
import { singingRatingEnabled, rateSingingClip } from "../lib/singing-rating";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Scoped to just this route — everything else expects a JSON body via the
// global express.json() middleware, but this one receives raw audio bytes.
router.post(
  "/sing-rating",
  express.raw({ type: "*/*", limit: "15mb" }),
  async (req: Request, res: Response): Promise<void> => {
    if (!singingRatingEnabled()) {
      res.status(503).json({ error: "Singing ratings aren't configured — set OPENAI_API_KEY to enable this." });
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Expected a non-empty audio clip in the request body" });
      return;
    }

    try {
      const rating = await rateSingingClip(req.body);
      res.json(rating);
    } catch (err) {
      logger.error({ err }, "singing rating failed");
      res.status(502).json({ error: "Couldn't rate that clip — try again" });
    }
  },
);

export default router;
