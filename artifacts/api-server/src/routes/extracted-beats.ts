import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import os from "os";
import { db, extractedBeatsTable } from "@workspace/db";
import { searchVideos } from "../lib/youtube";
import { objectStorageClient } from "../lib/objectStorage";

import { YTDLP_BIN as YTDLP, YTDLP_CACHE_DIR, cookieArgs } from "../lib/ytdlp";

const router: IRouter = Router();

// Paths
const PYTHON  = process.env.PYTHON_PATH  ?? path.resolve(__dirname, "../../../.pythonlibs/bin/python3");
const EXTRACT_SCRIPT = path.resolve(__dirname, "../../../scripts/extract_beat.py");

// ── In-memory job store ───────────────────────────────────────────────────────
interface Job {
  status: "running" | "done" | "error";
  step: "download" | "extract" | "upload";
  message: string;
  pct: number;
  result?: Record<string, unknown>;
  error?: string;
  startedAt: number;
}

const jobs = new Map<string, Job>();

// Auto-expire jobs after 30 min
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.startedAt < cutoff) jobs.delete(id);
  }
}, 5 * 60 * 1000);

// ── Process runner ────────────────────────────────────────────────────────────
interface RunOpts {
  timeoutMs?: number;
  onStderr?: (line: string) => void;
  signal?: AbortSignal;
}

function runProcess(cmd: string, args: string[], opts: RunOpts = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 10 * 60 * 1000, onStderr, signal } = opts;
    const child = spawn(cmd, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      err.push(d);
      if (onStderr) {
        d.toString().split("\n").filter(Boolean).forEach((l) => onStderr(l));
      }
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Process timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    const onAbort = () => { child.kill("SIGKILL"); reject(new Error("Cancelled")); };
    signal?.addEventListener("abort", onAbort);

    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve(Buffer.concat(out).toString().trim());
      else reject(new Error(Buffer.concat(err).toString().trim() || `Process exited with code ${code}`));
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function downloadAudio(videoId: string, outDir: string, opts: RunOpts = {}): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  // Pre-flight check (fast fail ~1-2s for unavailable videos)
  try {
    await runProcess(YTDLP, [
      "--cache-dir", YTDLP_CACHE_DIR,
      "--no-playlist", "--simulate", "--no-warnings",
      ...cookieArgs(), url,
    ], { ...opts, timeoutMs: 30_000 });
  } catch (e: any) {
    const msg = e.message ?? "";
    if (msg.includes("unavailable") || msg.includes("Private") || msg.includes("Sign in")) {
      throw new Error(
        "Video unavailable for download — likely blocked by Content ID (major label). " +
        "Try a lyrics video, audio-only upload, or an indie version."
      );
    }
    throw e;
  }

  // Actual download
  await runProcess(YTDLP, [
    "--cache-dir", YTDLP_CACHE_DIR, "--no-playlist",
    "--format", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
    "--no-warnings", "-o", path.join(outDir, "%(id)s.%(ext)s"),
    ...cookieArgs(), url,
  ], { ...opts, timeoutMs: 3 * 60 * 1000 });

  const files = fs.readdirSync(outDir).filter((f) => f.startsWith(videoId));
  if (!files.length) throw new Error("yt-dlp succeeded but no output file found");
  return path.join(outDir, files[0]);
}

async function uploadToStorage(localFile: string, objectName: string, contentType: string): Promise<string> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
  const stripped = privateDir.startsWith("/") ? privateDir.slice(1) : privateDir;
  const [bucketName, ...prefixParts] = stripped.split("/");
  const prefix = prefixParts.join("/");
  const fullObjectName = prefix ? `${prefix}/${objectName}` : objectName;
  const bucket = objectStorageClient.bucket(bucketName);
  await bucket.file(fullObjectName).save(fs.readFileSync(localFile), { contentType, resumable: false });
  return `/objects/${objectName}`;
}

// ── Background extraction runner ──────────────────────────────────────────────
async function runExtraction(
  jobId: string,
  videoId: string,
  title: string,
  thumbnailUrl: string,
  channelName: string,
) {
  const job = jobs.get(jobId)!;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tubefeed-ext-"));
  const demucsOut = path.join(tmpDir, "demucs");
  const ac = new AbortController();

  const update = (step: Job["step"], message: string, pct: number) => {
    const j = jobs.get(jobId);
    if (j) Object.assign(j, { step, message, pct });
  };

  try {
    update("download", "Downloading audio from YouTube…", 5);
    const audioFile = await downloadAudio(videoId, tmpDir, { signal: ac.signal });
    update("download", "Audio downloaded ✓", 30);

    update("extract", "Running AI vocal separation (1–3 min)…", 35);
    let lastMsg = "";
    const noVocalsPath = await runProcess(PYTHON, [EXTRACT_SCRIPT, audioFile, demucsOut], {
      signal: ac.signal,
      timeoutMs: 8 * 60 * 1000,
      onStderr: (line) => {
        if (line === lastMsg) return;
        lastMsg = line;
        const l = line.toLowerCase();
        if (l.includes("%") || l.includes("separating") || l.includes("loading") || l.includes("model")) {
          update("extract", line.trim().slice(0, 80), 50);
        }
      },
    });

    if (!noVocalsPath || !fs.existsSync(noVocalsPath)) throw new Error("Demucs produced no output");
    update("extract", "Vocals separated ✓", 80);

    // Demucs puts vocals.mp3 in the same folder as no_vocals.mp3
    const vocalsPath = noVocalsPath.replace("no_vocals.mp3", "vocals.mp3");

    update("upload", "Uploading tracks to cloud…", 85);
    const [objectPath, vocalsObjectPath] = await Promise.all([
      uploadToStorage(noVocalsPath, `extracted-beats/${videoId}-instrumental.mp3`, "audio/mpeg"),
      fs.existsSync(vocalsPath)
        ? uploadToStorage(vocalsPath, `extracted-beats/${videoId}-vocals.mp3`, "audio/mpeg")
        : Promise.resolve(null),
    ]);

    const [created] = await db
      .insert(extractedBeatsTable)
      .values({ videoId, title, thumbnailUrl, channelName, objectPath, vocalsObjectPath })
      .returning();

    job.status = "done";
    job.pct = 100;
    job.result = created as Record<string, unknown>;
  } catch (err: any) {
    job.status = "error";
    job.error = err.message;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/search-songs", async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  if (!q) { res.status(400).json({ error: "q is required" }); return; }
  try {
    res.json(await searchVideos(q, 12));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/extracted-beats", async (_req, res): Promise<void> => {
  const rows = await db.select().from(extractedBeatsTable).orderBy(desc(extractedBeatsTable.createdAt));
  res.json(rows);
});

router.delete("/extracted-beats/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(extractedBeatsTable).where(eq(extractedBeatsTable.id, id));
  res.json({ ok: true });
});

// Poll endpoint — returns current job status (client polls every 1-2s)
router.get("/extracted-beats/job/:jobId", (req, res): void => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({
    status: job.status,
    step: job.step,
    message: job.message,
    pct: job.pct,
    result: job.result,
    error: job.error,
  });
});

// Start extraction job — returns jobId immediately, no streaming
router.post("/extracted-beats", async (req, res): Promise<void> => {
  const { videoId, title, thumbnailUrl = "", channelName = "" } = req.body as {
    videoId?: string; title?: string; thumbnailUrl?: string; channelName?: string;
  };
  if (!videoId || !title) { res.status(400).json({ error: "videoId and title are required" }); return; }

  // Return cached result immediately
  const [existing] = await db.select().from(extractedBeatsTable).where(eq(extractedBeatsTable.videoId, videoId));
  if (existing) {
    res.json({ cached: true, result: existing });
    return;
  }

  // Create job and start background extraction
  const jobId = randomUUID();
  jobs.set(jobId, {
    status: "running",
    step: "download",
    message: "Starting…",
    pct: 0,
    startedAt: Date.now(),
  });

  // Fire and forget — don't await
  runExtraction(jobId, videoId, title, thumbnailUrl, channelName).catch(() => {/* handled inside */});

  res.json({ jobId });
});

export default router;
