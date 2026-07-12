import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";
import { getYtdlpBin } from "../lib/ytdlp";

const router: IRouter = Router();

// GET /api/video-url?url=<instagram_or_tiktok_url>
// Returns the direct CDN streaming URL without downloading the video.
// Used by Reel Journal to play saved references inline.
router.get("/video-url", async (req: Request, res: Response): Promise<void> => {
  const url = typeof req.query["url"] === "string" ? req.query["url"].trim() : null;
  if (!url) {
    res.status(400).json({ error: "url query parameter required" });
    return;
  }

  const ytdlp = getYtdlpBin();

  const result = await new Promise<{ url: string | null; error: string | null }>((resolve) => {
    const lines: string[] = [];
    const child = spawn(ytdlp, [
      "--no-playlist",
      "-f", "best[ext=mp4]/mp4/best",
      "--get-url",
      url,
    ]);

    child.stdout.on("data", (buf: Buffer) => {
      lines.push(...buf.toString().split("\n").map(l => l.trim()).filter(Boolean));
    });

    const errLines: string[] = [];
    child.stderr.on("data", (buf: Buffer) => {
      errLines.push(buf.toString().trim());
    });

    child.on("close", (code) => {
      const videoUrl = lines.find(l => l.startsWith("http")) ?? null;
      if (code === 0 && videoUrl) {
        resolve({ url: videoUrl, error: null });
      } else {
        resolve({ url: null, error: errLines.slice(-3).join(" | ") || "yt-dlp failed" });
      }
    });

    child.on("error", (err) => resolve({ url: null, error: err.message }));

    // 15s timeout
    setTimeout(() => {
      child.kill();
      resolve({ url: null, error: "timeout" });
    }, 15_000);
  });

  if (result.url) {
    res.json({ videoUrl: result.url });
  } else {
    res.status(502).json({ error: result.error });
  }
});

export default router;
