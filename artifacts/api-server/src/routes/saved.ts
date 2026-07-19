import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import os from "os";
import { db, savedVideosTable } from "@workspace/db";
import { fetchVideoById } from "../lib/youtube";
import { getYtdlpBin, YTDLP_CACHE_DIR, MP3_STORAGE_DIR, ffmpegArgs, cookieArgs } from "../lib/ytdlp";

const router: IRouter = Router();

fs.mkdirSync(MP3_STORAGE_DIR, { recursive: true });

function mp3PathFor(videoId: string): string {
  return path.join(MP3_STORAGE_DIR, `${videoId}.mp3`);
}

// ── mp3 extraction job store ─────────────────────────────────────────────────
interface Mp3Job {
  status: "running" | "done" | "error";
  message: string;
  pct: number;
  error?: string;
  startedAt: number;
}

const mp3Jobs = new Map<string, Mp3Job>();

// Auto-expire finished job records after 30 min (the mp3 file itself is
// unaffected — it lives on disk under MP3_STORAGE_DIR, not in this map).
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of mp3Jobs) {
    if (job.startedAt < cutoff) mp3Jobs.delete(id);
  }
}, 5 * 60 * 1000);

async function downloadMp3(videoId: string, outDir: string): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outTemplate = path.join(outDir, "%(id)s.%(ext)s");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(getYtdlpBin(), [
      "--cache-dir", YTDLP_CACHE_DIR,
      "--no-playlist",
      "--extractor-args", "youtube:player_client=android,ios,tv_embedded,web_embedded",
      ...ffmpegArgs(),
      "-x", "--audio-format", "mp3", "--audio-quality", "0",
      "--output", outTemplate,
      ...cookieArgs(),
      url,
    ]);

    const lines: string[] = [];
    child.stderr.on("data", (buf: Buffer) => lines.push(buf.toString().trim()));
    child.stdout.on("data", (buf: Buffer) => lines.push(buf.toString().trim()));

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(lines.filter(Boolean).slice(-8).join(" | ") || `yt-dlp exited ${code}`));
    });
    child.on("error", reject);
  });

  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".mp3"));
  if (!files.length) throw new Error("yt-dlp produced no mp3 output");
  return path.join(outDir, files[0]);
}

async function runMp3Extraction(jobId: string, videoId: string) {
  const job = mp3Jobs.get(jobId)!;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tubedl-mp3-"));

  try {
    job.message = "Downloading and converting to mp3…";
    job.pct = 10;
    const downloadedFile = await downloadMp3(videoId, tmpDir);

    job.message = "Saving to storage…";
    job.pct = 90;
    fs.copyFileSync(downloadedFile, mp3PathFor(videoId));

    job.status = "done";
    job.pct = 100;
    job.message = "Ready";
  } catch (err: any) {
    job.status = "error";
    job.error = err.message;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function parseVideoId(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1).split("?")[0] || null;
    }
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      const shorts = url.pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/);
      if (shorts) return shorts[1];
      const embed = url.pathname.match(/\/embed\/([A-Za-z0-9_-]+)/);
      if (embed) return embed[1];
    }
  } catch {
    if (/^[A-Za-z0-9_-]{11}$/.test(input.trim())) {
      return input.trim();
    }
  }
  return null;
}

router.get("/saved", async (req, res): Promise<void> => {
  const saved = await db
    .select()
    .from(savedVideosTable)
    .orderBy(savedVideosTable.savedAt);
  saved.reverse();
  res.json(saved);
});

router.get("/saved/:videoId", async (req, res): Promise<void> => {
  const { videoId } = req.params;
  const [row] = await db
    .select()
    .from(savedVideosTable)
    .where(eq(savedVideosTable.videoId, videoId));
  if (!row) { res.status(404).json({ saved: false }); return; }
  res.json({ saved: true });
});

router.post("/saved", async (req, res): Promise<void> => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const videoId = parseVideoId(url.trim());
  if (!videoId) {
    res.status(400).json({ error: "Could not extract a YouTube video ID from that URL" });
    return;
  }

  const existing = await db
    .select()
    .from(savedVideosTable)
    .where(eq(savedVideosTable.videoId, videoId));

  if (existing.length > 0) {
    res.json(existing[0]);
    return;
  }

  const video = await fetchVideoById(videoId);
  if (!video) {
    res.status(404).json({ error: "Video not found on YouTube" });
    return;
  }

  const [inserted] = await db
    .insert(savedVideosTable)
    .values({
      videoId: video.videoId,
      title: video.title,
      description: video.description,
      thumbnailUrl: video.thumbnailUrl,
      channelId: video.channelId,
      channelName: video.channelName,
      channelThumbnailUrl: video.channelThumbnailUrl,
      viewCount: video.viewCount,
      duration: video.duration,
      publishedAt: video.publishedAt,
    })
    .returning();

  res.status(201).json(inserted);
});

router.delete("/saved/:videoId", async (req, res): Promise<void> => {
  const { videoId } = req.params;
  await db
    .delete(savedVideosTable)
    .where(eq(savedVideosTable.videoId, videoId));
  res.status(204).send();
});

// Start (or resume) mp3 extraction for a saved video. Returns immediately
// with a jobId — poll /saved/:videoId/mp3/job/:jobId for progress, then
// GET /saved/:videoId/mp3 to fetch the finished file.
router.post("/saved/:videoId/mp3", async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  const [row] = await db.select().from(savedVideosTable).where(eq(savedVideosTable.videoId, videoId));
  if (!row) { res.status(404).json({ error: "Video is not saved" }); return; }

  if (fs.existsSync(mp3PathFor(videoId))) {
    res.json({ cached: true });
    return;
  }

  const jobId = randomUUID();
  mp3Jobs.set(jobId, { status: "running", message: "Starting…", pct: 0, startedAt: Date.now() });
  runMp3Extraction(jobId, videoId).catch(() => {});
  res.json({ jobId });
});

router.get("/saved/:videoId/mp3/job/:jobId", (req: Request, res: Response): void => {
  const job = mp3Jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({
    status: job.status,
    message: job.message,
    pct: job.pct,
    error: job.error,
  });
});

// Fetch the mp3 for a saved video. 404s with needsExtraction:true if it
// hasn't been extracted yet — call POST /saved/:videoId/mp3 first.
router.get("/saved/:videoId/mp3", async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  const filePath = mp3PathFor(videoId);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "mp3 not yet extracted", needsExtraction: true });
    return;
  }

  const stat = fs.statSync(filePath);
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Accept-Ranges", "bytes");

  const rangeHeader = req.headers.range;
  if (rangeHeader && stat.size > 0) {
    const m = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      res.setHeader("Content-Length", String(end - start + 1));
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  res.setHeader("Content-Length", stat.size);
  fs.createReadStream(filePath).pipe(res);
});

export default router;
