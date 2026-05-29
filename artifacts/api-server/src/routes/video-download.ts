import { Router, type IRouter, type Request, type Response } from "express";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import os from "os";
import { logger } from "../lib/logger";
import { getYtdlpBin, YTDLP_CACHE_DIR, FFMPEG_DIR, ffmpegArgs, cookieArgs } from "../lib/ytdlp";

const router: IRouter = Router();

// ── Job store ────────────────────────────────────────────────────────────────
interface DlJob {
  status: "running" | "done" | "error";
  pct: number;
  message: string;
  fileId?: string;
  filename?: string;
  error?: string;
  startedAt: number;
  format: "mp4" | "mp3";
}

const jobs = new Map<string, DlJob>();
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

// ── Quality / format selection ───────────────────────────────────────────────
const FORMAT_1080 = [
  "bestvideo[height<=1080]+bestaudio",
  "bestvideo[height<=1080]+bestaudio[ext=m4a]",
  "bestvideo+bestaudio",
  "best",
].join("/");

// ── Proxy helpers ────────────────────────────────────────────────────────────
const BOT_PHRASES = [
  "sign in", "bot", "429", "403", "blocked", "unavailable",
  "private video", "video unavailable", "confirm your age",
  "http error 407", "proxy", "nsig", "sabr",
];

function isRetryable(text: string): boolean {
  const lower = text.toLowerCase();
  return BOT_PHRASES.some((p) => lower.includes(p));
}

function getProxyList(): Array<string | null> {
  const raw = process.env.YTDLP_PROXY_LIST?.trim() ?? "";
  const proxies: string[] = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  for (let i = proxies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [proxies[i], proxies[j]] = [proxies[j], proxies[i]];
  }

  const unique = [...new Set(proxies)].slice(0, 3);
  return [...unique, null];
}

// ── Download worker ──────────────────────────────────────────────────────────
async function spawnDownload(
  ytdlpBin: string,
  extraArgs: string[],
  outTemplate: string,
  url: string,
  sectionArgs: string[],
  formatArgs: string[],
  onProgress: (pct: number, merging: boolean) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ytdlpBin, [
      "--cache-dir", YTDLP_CACHE_DIR,
      "--no-playlist",
      "--extractor-args", "youtube:player_client=web_embedded,web",
      "--impersonate", "chrome",
      ...extraArgs,
      ...ffmpegArgs(),
      ...formatArgs,
      "--output", outTemplate,
      "--progress",
      "--newline",
      ...sectionArgs,
      ...cookieArgs(),
      url,
    ]);

    const lines: string[] = [];

    const handleText = (text: string) => {
      lines.push(text.trim());
      const m = text.match(/\[download\]\s+([\d.]+)%/);
      if (m) {
        onProgress(Math.round(parseFloat(m[1])), false);
      } else if (text.includes("[Merger]") || text.includes("[ffmpeg]") || text.includes("[ExtractAudio]")) {
        onProgress(97, true);
      }
    };

    child.stderr.on("data", (buf: Buffer) => handleText(buf.toString()));
    child.stdout.on("data", (buf: Buffer) => handleText(buf.toString()));

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const detail = lines.filter(Boolean).slice(-8).join(" | ");
        const err = new Error(`yt-dlp exited ${code}: ${detail}`);
        (err as any).retryable = isRetryable(detail);
        reject(err);
      }
    });
    child.on("error", reject);
  });
}

async function runDownload(
  jobId: string,
  videoId: string,
  title: string,
  format: "mp4" | "mp3",
  startTime?: string,
  endTime?: string,
) {
  const job = jobs.get(jobId)!;
  const isClip = Boolean(startTime || endTime);

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const sectionArgs: string[] = [];
  if (isClip) {
    const start = startTime?.trim() || "0";
    const end   = endTime?.trim()   || "inf";
    sectionArgs.push("--download-sections", `*${start}-${end}`);
    sectionArgs.push("--force-keyframes-at-cuts");
  }

  // Build format-specific yt-dlp args
  const isMp3 = format === "mp3";
  const formatArgs = isMp3
    ? ["-x", "--audio-format", "mp3", "--audio-quality", "0"]
    : ["--format", FORMAT_1080, "--merge-output-format", "mp4"];
  const ext = isMp3 ? "mp3" : "mp4";

  const proxyList = getProxyList();
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < proxyList.length; attempt++) {
    const proxy = proxyList[attempt];
    const isLastAttempt = attempt === proxyList.length - 1;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tubefeed-vdl-"));

    if (attempt > 0) {
      job.message = proxy
        ? `Retrying with different proxy… (${attempt + 1}/${proxyList.length})`
        : "Retrying direct connection…";
      job.pct = 0;
    }

    const extraArgs = proxy ? ["--proxy", proxy] : [];
    const outTemplate = isMp3
      ? path.join(tmpDir, "%(title)s.%(ext)s")
      : path.join(tmpDir, "%(title)s [%(height)sp].%(ext)s");

    try {
      await spawnDownload(
        getYtdlpBin(),
        extraArgs,
        outTemplate,
        url,
        sectionArgs,
        formatArgs,
        (pct, merging) => {
          if (merging) {
            job.pct = 97;
            job.message = isMp3 ? "Converting to MP3…" : "Merging audio + video…";
          } else {
            job.pct = Math.min(pct, 95);
            job.message = `Downloading… ${pct}%`;
          }
        },
      );

      const outFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(`.${ext}`));
      if (!outFiles.length) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        throw new Error("Download produced no output file");
      }

      const filePath = path.join(tmpDir, outFiles[0]);
      const fileId = randomUUID();
      files.set(fileId, filePath);

      job.status = "done";
      job.pct = 100;
      job.message = "Ready to download";
      job.fileId = fileId;
      job.filename = outFiles[0];
      return;
    } catch (err: any) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      lastErr = err;
      const retryable = err.retryable !== false;
      logger.warn({ videoId, format, attempt, proxy: proxy ?? "direct", err: err.message }, "download attempt failed");

      if (!retryable && !isLastAttempt) continue;
      if (isLastAttempt) break;
    }
  }

  logger.error({ videoId, format, err: lastErr }, "video download failed after all attempts");
  job.status = "error";
  job.error = lastErr?.message ?? "Download failed";
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.post("/video-download", async (req: Request, res: Response): Promise<void> => {
  const { videoId, title, format, startTime, endTime } = req.body ?? {};
  if (!videoId || typeof videoId !== "string") {
    res.status(400).json({ error: "videoId is required" });
    return;
  }

  const dlFormat: "mp4" | "mp3" = format === "mp3" ? "mp3" : "mp4";
  const isClip = Boolean(startTime || endTime);

  const jobId = randomUUID();
  const job: DlJob = {
    status: "running",
    pct: 0,
    format: dlFormat,
    message: isClip
      ? `Preparing clip ${startTime ?? "0:00"}–${endTime ?? "end"}…`
      : `Starting ${dlFormat.toUpperCase()} download…`,
    startedAt: Date.now(),
  };
  jobs.set(jobId, job);

  runDownload(jobId, videoId, title ?? videoId, dlFormat, startTime, endTime).catch(() => {});

  res.json({ jobId });
});

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
    format: job.format,
  });
});

router.get("/video-download/file/:fileId", (req: Request, res: Response): void => {
  const filePath = files.get(req.params.fileId);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found or expired" });
    return;
  }

  const stat = fs.statSync(filePath);
  const filename = path.basename(filePath);
  const isMp3 = filename.endsWith(".mp3");

  res.setHeader("Content-Type", isMp3 ? "audio/mpeg" : "video/mp4");
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
