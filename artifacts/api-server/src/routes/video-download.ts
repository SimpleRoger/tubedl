import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import os from "os";
import { YTDLP_BIN as YTDLP, YTDLP_CACHE_DIR, FFMPEG_DIR, ffmpegArgs, cookieArgs } from "../lib/ytdlp";

const router: IRouter = Router();

// ── Job store ────────────────────────────────────────────────────────────────
interface DlJob {
  status: "running" | "done" | "error";
  pct: number;
  message: string;
  fileId?: string;   // UUID → maps to a temp file path
  filename?: string; // e.g. "Song Title [1080p].mp4"
  error?: string;
  startedAt: number;
}

const jobs = new Map<string, DlJob>();
// Map fileId → absolute path to temp file
const files = new Map<string, string>();

// Auto-expire jobs + temp files after 60 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.startedAt < cutoff) {
      if (job.fileId) {
        const fp = files.get(job.fileId);
        if (fp) { try { fs.unlinkSync(fp); } catch {} }
        files.delete(job.fileId);
      }
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000);

// ── Quality selection ────────────────────────────────────────────────────────
// Prefer native 1080p mp4+m4a merged by ffmpeg; fall back to best progressive
const FORMAT_1080 = [
  "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]",
  "bestvideo[height<=1080]+bestaudio",
  "best[height<=1080][ext=mp4]",
  "best",
].join("/");

// ── Download worker ──────────────────────────────────────────────────────────
async function runDownload(
  jobId: string,
  videoId: string,
  title: string,
  startTime?: string,
  endTime?: string,
) {
  const job = jobs.get(jobId)!;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tubefeed-vdl-"));
  const isClip = Boolean(startTime || endTime);

  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    // Build section string: "*1:02-1:13", "*-1:13" (from start), "*1:02-inf" (to end)
    const sectionArgs: string[] = [];
    if (isClip) {
      const start = startTime?.trim() || "0";
      const end   = endTime?.trim()   || "inf";
      sectionArgs.push("--download-sections", `*${start}-${end}`);
      // Keep chapters aligned after cutting
      sectionArgs.push("--force-keyframes-at-cuts");
    }

    const outTemplate = path.join(tmpDir, "%(title)s [%(height)sp].%(ext)s");

    await new Promise<void>((resolve, reject) => {
      const child = spawn(YTDLP, [
        "--cache-dir", YTDLP_CACHE_DIR,
        "--no-playlist",
        ...ffmpegArgs(),
        "--format", FORMAT_1080,
        "--merge-output-format", "mp4",
        "--output", outTemplate,
        "--progress",
        "--newline",
        ...sectionArgs,
        ...cookieArgs(),
        url,
      ]);

      child.stderr.on("data", (buf: Buffer) => {
        const text = buf.toString();
        // yt-dlp progress lines: "[download]  42.5% of ~100MiB..."
        const m = text.match(/\[download\]\s+([\d.]+)%/);
        if (m) {
          const pct = Math.round(parseFloat(m[1]));
          job.pct = Math.min(pct, 95);
          job.message = `Downloading… ${pct}%`;
        } else if (text.includes("[Merger]") || text.includes("[ffmpeg]")) {
          job.pct = 97;
          job.message = "Merging audio + video…";
        }
      });

      child.stdout.on("data", (buf: Buffer) => {
        const text = buf.toString();
        const m = text.match(/\[download\]\s+([\d.]+)%/);
        if (m) {
          const pct = Math.round(parseFloat(m[1]));
          job.pct = Math.min(pct, 95);
          job.message = `Downloading… ${pct}%`;
        }
      });

      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited with code ${code}`));
      });
      child.on("error", reject);
    });

    // Find the output file
    const files2 = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".mp4"));
    if (!files2.length) throw new Error("Download produced no output file");

    const filePath = path.join(tmpDir, files2[0]);
    const fileId = randomUUID();
    files.set(fileId, filePath);

    job.status = "done";
    job.pct = 100;
    job.message = "Ready to download";
    job.fileId = fileId;
    job.filename = files2[0];
  } catch (err: any) {
    // Clean up
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    job.status = "error";
    job.error = err.message ?? "Download failed";
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Start a download job
router.post("/video-download", async (req: Request, res: Response): Promise<void> => {
  const { videoId, title, startTime, endTime } = req.body ?? {};
  if (!videoId || typeof videoId !== "string") {
    res.status(400).json({ error: "videoId is required" });
    return;
  }

  const jobId = randomUUID();
  const isClip = Boolean(startTime || endTime);
  const job: DlJob = {
    status: "running",
    pct: 0,
    message: isClip
      ? `Preparing clip ${startTime ?? "0:00"}–${endTime ?? "end"}…`
      : "Starting download…",
    startedAt: Date.now(),
  };
  jobs.set(jobId, job);

  // Fire-and-forget
  runDownload(jobId, videoId, title ?? videoId, startTime, endTime).catch(() => {});

  res.json({ jobId });
});

// Poll job status
router.get("/video-download/job/:jobId", (req: Request, res: Response): void => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({
    status: job.status,
    pct: job.pct,
    message: job.message,
    fileId: job.fileId,
    filename: job.filename,
    error: job.error,
  });
});

// Serve the completed download file
router.get("/video-download/file/:fileId", (req: Request, res: Response): void => {
  const filePath = files.get(req.params.fileId);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found or expired" });
    return;
  }

  const stat = fs.statSync(filePath);
  const filename = path.basename(filePath);

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader("Accept-Ranges", "bytes");

  const rangeHeader = req.headers.range;
  if (rangeHeader && stat.size > 0) {
    const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end   = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  fs.createReadStream(filePath).pipe(res);
});

export default router;
