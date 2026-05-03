import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import path from "path";
import { getYtdlpBin, cookieArgs, serverArgs } from "../lib/ytdlp";

const router: IRouter = Router();

const PYTHON = process.env.PYTHON_PATH ?? path.resolve(__dirname, "../../../.pythonlibs/bin/python3");
const DETECT_SCRIPT = path.resolve(__dirname, "../../../scripts/detect_bpm.py");

router.get("/detect-bpm/:videoId", async (req, res) => {
  const { videoId } = req.params;
  if (!videoId || !/^[a-zA-Z0-9_-]{6,15}$/.test(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const ytdlp = getYtdlpBin();
  const cookies = cookieArgs();
  const servers = serverArgs();

  try {
    const result = await new Promise<{ bpm: number }>((resolve, reject) => {
      const args = [DETECT_SCRIPT, videoId, ytdlp, ...cookies, ...servers];
      const child = spawn(PYTHON, args);
      const out: Buffer[] = [];
      const err: Buffer[] = [];

      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", (d: Buffer) => err.push(d));

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Timed out"));
      }, 120_000);

      child.on("close", (code) => {
        clearTimeout(timer);
        const stdout = Buffer.concat(out).toString().trim();
        if (code !== 0 || !stdout) {
          reject(new Error(Buffer.concat(err).toString().trim() || "Script failed"));
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) reject(new Error(parsed.error));
          else resolve(parsed as { bpm: number });
        } catch {
          reject(new Error("Bad JSON from script"));
        }
      });
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "detect-bpm failed");
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
