import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { db, beatChannelsTable } from "@workspace/db";
import { AddChannelBody, RemoveChannelParams } from "@workspace/api-zod";
import { resolveChannelInfo, searchChannels, fetchRecentVideos } from "../lib/youtube";

import { YTDLP_BIN as YTDLP, YTDLP_CACHE_DIR, cookieArgs } from "../lib/ytdlp";

// Pre-warm the EJS remote component cache at startup so the first real
// download isn't slow. Run in background — never blocks the server.
function warmEjsCache() {
  const nodeExec = process.execPath;
  const args = [
    "--simulate",
    "--quiet",
    "--no-warnings",
    "--js-runtimes", `node:${nodeExec}`,
    "--remote-components", "ejs:github",
    "--cache-dir", YTDLP_CACHE_DIR,
    ...cookieArgs(),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ];
  const p = spawn(YTDLP, args, { stdio: "ignore" });
  p.on("close", (_code) => {});
}
warmEjsCache();

const router: IRouter = Router();

router.get("/beat-channels/search", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) { res.json([]); return; }
  const results = await searchChannels(q);
  res.json(results);
});

router.get("/beat-channels", async (_req, res): Promise<void> => {
  const channels = await db.select().from(beatChannelsTable).orderBy(beatChannelsTable.addedAt);
  res.json(channels);
});

router.post("/beat-channels", async (req, res): Promise<void> => {
  const parsed = AddChannelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  let channelInfo;
  try {
    channelInfo = await resolveChannelInfo(parsed.data.youtubeChannelId);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to resolve channel" });
    return;
  }

  const existing = await db.select().from(beatChannelsTable).where(eq(beatChannelsTable.youtubeChannelId, channelInfo.id));
  if (existing.length > 0) { res.status(400).json({ error: "Channel already added" }); return; }

  const [channel] = await db.insert(beatChannelsTable).values({
    youtubeChannelId: channelInfo.id,
    name: channelInfo.name,
    thumbnailUrl: channelInfo.thumbnailUrl,
  }).returning();

  res.status(201).json(channel);
});

router.delete("/beat-channels/:id", async (req, res): Promise<void> => {
  const params = RemoveChannelParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [deleted] = await db.delete(beatChannelsTable).where(eq(beatChannelsTable.id, params.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: "Channel not found" }); return; }
  res.sendStatus(204);
});

router.get("/beats", async (req, res): Promise<void> => {
  const channelId = req.query.channelId ? Number(req.query.channelId) : undefined;

  const channels = channelId
    ? await db.select().from(beatChannelsTable).where(eq(beatChannelsTable.id, channelId))
    : await db.select().from(beatChannelsTable);

  if (channels.length === 0) { res.json([]); return; }

  const results = await Promise.allSettled(
    channels.map((c) => fetchRecentVideos(c.youtubeChannelId, c.name, c.thumbnailUrl ?? null))
  );

  const videos = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchRecentVideos>>> => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .map((v) => ({ ...v, publishedAt: v.publishedAt.toISOString() }));

  res.json(videos);
});

router.get("/beats/search", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const order = typeof req.query.order === "string" && ["relevance", "date", "viewCount"].includes(req.query.order)
    ? req.query.order
    : "relevance";
  const maxResults = Math.min(parseInt(typeof req.query.maxResults === "string" ? req.query.maxResults : "10", 10) || 10, 25);

  if (!q) { res.json([]); return; }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) { res.status(500).json({ error: "YouTube API key not configured" }); return; }

  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(q)}&order=${order}&maxResults=${maxResults}&key=${apiKey}`;
  const searchResp = await fetch(url);
  if (!searchResp.ok) {
    res.status(500).json({ error: "YouTube search failed" });
    return;
  }

  const searchData = (await searchResp.json()) as {
    items?: Array<{
      id: { videoId: string };
      snippet: { title: string; description: string; publishedAt: string; channelId: string; channelTitle: string; thumbnails?: { medium?: { url: string }; default?: { url: string } } };
    }>;
  };

  const items = searchData.items ?? [];
  if (items.length === 0) { res.json([]); return; }

  const videoIds = items.map((i) => i.id.videoId).join(",");
  let statsMap = new Map<string, { viewCount?: string; duration?: string }>();
  const vResp = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${encodeURIComponent(videoIds)}&key=${apiKey}`);
  if (vResp.ok) {
    const vData = (await vResp.json()) as { items?: Array<{ id: string; statistics?: { viewCount?: string }; contentDetails?: { duration?: string } }> };
    for (const v of vData.items ?? []) statsMap.set(v.id, { viewCount: v.statistics?.viewCount, duration: v.contentDetails?.duration });
  }

  const results = items.map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
    publishedAt: item.snippet.publishedAt,
    viewCount: statsMap.get(item.id.videoId)?.viewCount ?? null,
    channelId: item.snippet.channelId,
    channelName: item.snippet.channelTitle,
    channelThumbnailUrl: null,
    duration: statsMap.get(item.id.videoId)?.duration ?? null,
  }));

  res.json(results);
});

router.get("/beats/:videoId/similar", async (req, res): Promise<void> => {
  const { videoId } = req.params;
  const title = typeof req.query.title === "string" ? req.query.title : "";

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) { res.status(500).json({ error: "YouTube API key not configured" }); return; }

  const query = `${title} beat type beat`;
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=10&key=${apiKey}`;
  const searchResp = await fetch(url);
  if (!searchResp.ok) { res.json([]); return; }

  const searchData = (await searchResp.json()) as {
    items?: Array<{
      id: { videoId: string };
      snippet: { title: string; description: string; publishedAt: string; channelId: string; channelTitle: string; thumbnails?: { medium?: { url: string }; default?: { url: string } } };
    }>;
  };

  const items = (searchData.items ?? []).filter((i) => i.id.videoId !== videoId);

  const videoIds = items.map((i) => i.id.videoId).join(",");
  let durMap = new Map<string, string>();
  if (videoIds) {
    const vResp = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${encodeURIComponent(videoIds)}&key=${apiKey}`);
    if (vResp.ok) {
      const vData = (await vResp.json()) as { items?: Array<{ id: string; contentDetails?: { duration?: string } }> };
      for (const v of vData.items ?? []) durMap.set(v.id, v.contentDetails?.duration ?? "");
    }
  }

  const similar = items.map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnailUrl: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
    publishedAt: item.snippet.publishedAt,
    viewCount: null,
    channelId: item.snippet.channelId,
    channelName: item.snippet.channelTitle,
    channelThumbnailUrl: null,
    duration: durMap.get(item.id.videoId) ?? null,
  }));

  res.json(similar);
});

// Map audio container extensions to MIME types
const AUDIO_MIME: Record<string, string> = {
  m4a: "audio/mp4",
  webm: "audio/webm",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  aac: "audio/aac",
};

router.get("/beats/:videoId/download", async (req, res): Promise<void> => {
  const { videoId } = req.params;
  const rawTitle = typeof req.query.title === "string" ? req.query.title : videoId;
  const safeName = rawTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 120) || videoId;

  // Download the best audio in its native container (no ffmpeg conversion).
  // yt-dlp names the file with the actual extension, so we use a unique prefix
  // and then glob for whichever file it created.
  const tmpDir = os.tmpdir();
  const tmpBase = path.join(tmpDir, `tubefeed-${videoId}-${Date.now()}`);
  // yt-dlp template: <tmpBase>.<ext>
  const tmpTemplate = `${tmpBase}.%(ext)s`;

  const cleanup = (file: string) => { try { fs.unlinkSync(file); } catch (_) {} };

  try {
    await new Promise<void>((resolve, reject) => {
      const nodeExec = process.execPath;
      const ytdlp = spawn(YTDLP, [
        // Download best audio in native format — no ffmpeg conversion step.
        "--format", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
        "-o", tmpTemplate,
        "--no-playlist",
        "--no-warnings",
        "--js-runtimes", `node:${nodeExec}`,
        "--remote-components", "ejs:github",
        "--cache-dir", YTDLP_CACHE_DIR,
        ...cookieArgs(),
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);

      const stderrLines: string[] = [];
      ytdlp.stderr.on("data", (chunk: Buffer) => {
        stderrLines.push(chunk.toString().trim());
      });

      ytdlp.on("error", (err: Error) => reject(err));
      ytdlp.on("close", (code: number | null) => {
        if (code !== 0) {
          reject(new Error(`yt-dlp exited ${code}: ${stderrLines.slice(-3).join(" | ")}`));
        } else {
          resolve();
        }
      });

      req.on("close", () => { ytdlp.kill("SIGTERM"); reject(new Error("client disconnected")); });
    });

    // Find the file yt-dlp wrote (extension is unknown ahead of time)
    const entries = fs.readdirSync(tmpDir).filter(f => f.startsWith(path.basename(tmpBase)));
    const outFile = entries.length > 0 ? path.join(tmpDir, entries[0]) : null;

    if (!outFile || !fs.existsSync(outFile)) {
      res.status(500).json({ error: "Download produced no output" });
      return;
    }

    const ext = path.extname(outFile).replace(".", "").toLowerCase();
    const mime = AUDIO_MIME[ext] ?? "application/octet-stream";
    const dlName = `${safeName}.${ext}`;

    const stat = fs.statSync(outFile);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${dlName}"`);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("X-Content-Type-Options", "nosniff");

    const readStream = fs.createReadStream(outFile);
    readStream.pipe(res);
    readStream.on("close", () => cleanup(outFile));
    readStream.on("error", (err) => {
      req.log?.error({ err }, "stream error after download");
      cleanup(outFile);
      if (!res.writableEnded) res.end();
    });
  } catch (err: unknown) {
    cleanup();
    const msg = err instanceof Error ? err.message : "Download failed";
    if (msg === "client disconnected") return;
    req.log?.error({ err, videoId }, "beat download failed");
    if (!res.headersSent) res.status(500).json({ error: msg });
    else if (!res.writableEnded) res.end();
  }
});

export default router;
