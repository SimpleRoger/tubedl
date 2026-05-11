import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { db, beatChannelsTable } from "@workspace/db";
import { AddChannelBody, RemoveChannelParams } from "@workspace/api-zod";
import { resolveChannelInfo, searchChannels, fetchRecentVideos } from "../lib/youtube";

import { getYtdlpBin, getFfmpegBin, YTDLP_CACHE_DIR, ffmpegArgs, cookieArgs, baseServerArgs, getProxyList } from "../lib/ytdlp";

const router: IRouter = Router();

function decodeHtml(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

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
    title: decodeHtml(item.snippet.title),
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
    title: decodeHtml(item.snippet.title),
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
  const startTime = typeof req.query.startTime === "string" ? req.query.startTime.trim() : undefined;
  const endTime   = typeof req.query.endTime   === "string" ? req.query.endTime.trim()   : undefined;
  const isClip = Boolean(startTime || endTime);

  const tmpDir = os.tmpdir();
  const stamp = Date.now();
  const tmpBase = path.join(tmpDir, `tubefeed-${videoId}-${stamp}`);
  const tmpTemplate = `${tmpBase}.%(ext)s`;

  const cleanup = (...files: string[]) => {
    for (const f of files) { try { fs.unlinkSync(f); } catch (_) {} }
  };

  let fullFile: string | null = null;
  let clipFile: string | null = null;

  try {
    // Step 1: Download full audio with proxy retry logic.
    // Try each proxy in turn; fall back to direct if all fail.
    const proxyList = getProxyList();
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < proxyList.length; attempt++) {
      const proxy = proxyList[attempt];
      const proxyArgs = proxy ? ["--proxy", proxy] : [];
      if (proxy) {
        req.log?.info({ proxy: proxy.replace(/:[^:@]+@/, ":***@"), attempt }, "beat download attempt");
      }

      const succeeded = await new Promise<boolean>((resolve) => {
        const ytdlp = spawn(getYtdlpBin(), [
          "--format", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
          "-o", tmpTemplate,
          "--no-playlist",
          "--no-warnings",
          "--cache-dir", YTDLP_CACHE_DIR,
          ...baseServerArgs(),
          ...proxyArgs,
          ...ffmpegArgs(),
          ...cookieArgs(),
          `https://www.youtube.com/watch?v=${videoId}`,
        ]);

        const stderrLines: string[] = [];
        ytdlp.stderr.on("data", (chunk: Buffer) => stderrLines.push(chunk.toString().trim()));
        ytdlp.on("error", (err: Error) => { lastErr = err; resolve(false); });
        ytdlp.on("close", (code: number | null) => {
          if (code === 0) {
            resolve(true);
          } else {
            const msg = stderrLines.slice(-3).join(" | ");
            lastErr = new Error(`yt-dlp exited ${code}: ${msg}`);
            resolve(false);
          }
        });
        req.on("close", () => { ytdlp.kill("SIGTERM"); lastErr = new Error("client disconnected"); resolve(false); });
      });

      if (succeeded) { lastErr = null; break; }
      if (lastErr?.message === "client disconnected") break;
      req.log?.warn({ attempt, proxy: proxy ?? "direct", err: lastErr?.message }, "beat download attempt failed, retrying");
    }

    if (lastErr) throw lastErr;

    // Find the file yt-dlp wrote (extension is unknown ahead of time)
    const entries = fs.readdirSync(tmpDir).filter(f => f.startsWith(path.basename(tmpBase)));
    fullFile = entries.length > 0 ? path.join(tmpDir, entries[0]) : null;

    if (!fullFile || !fs.existsSync(fullFile)) {
      res.status(500).json({ error: "Download produced no output" });
      return;
    }

    // Step 2: Trim with ffmpeg directly if a clip range was requested.
    // Using ffmpeg directly is more reliable than yt-dlp's --download-sections
    // because it operates on the already-downloaded file with no YouTube involvement.
    let outFile = fullFile;
    if (isClip) {
      const ffmpegBin = getFfmpegBin();
      if (!ffmpegBin) {
        cleanup(fullFile);
        res.status(500).json({ error: "ffmpeg not available — clip trimming requires ffmpeg" });
        return;
      }

      const ext = path.extname(fullFile);
      clipFile = `${tmpBase}-clip${ext}`;

      const ffArgs = ["-y", "-i", fullFile];
      if (startTime) ffArgs.push("-ss", startTime);
      if (endTime)   ffArgs.push("-to", endTime);
      // Copy codec — no re-encode, fast and lossless
      ffArgs.push("-c", "copy", clipFile);

      await new Promise<void>((resolve, reject) => {
        const ff = spawn(ffmpegBin, ffArgs);
        const errLines: string[] = [];
        ff.stderr.on("data", (chunk: Buffer) => errLines.push(chunk.toString()));
        ff.on("error", reject);
        ff.on("close", (code) => {
          if (code !== 0) reject(new Error(`ffmpeg exited ${code}: ${errLines.slice(-3).join(" | ")}`));
          else resolve();
        });
        req.on("close", () => { ff.kill("SIGTERM"); reject(new Error("client disconnected")); });
      });

      // Done with the full download now
      cleanup(fullFile);
      fullFile = null;
      outFile = clipFile;
    }

    // Step 3: Stream the file (full or clipped) to the client
    const ext = path.extname(outFile).replace(".", "").toLowerCase();
    const label = isClip ? ` (${startTime ?? "start"}-${endTime ?? "end"})` : "";
    const dlName = `${safeName}${label}.${ext}`;
    const asciiName = dlName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    const encodedName = encodeURIComponent(dlName).replace(/'/g, "%27");

    const stat = fs.statSync(outFile);
    const mime = AUDIO_MIME[ext] ?? "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
    );
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
    if (fullFile) cleanup(fullFile);
    if (clipFile) cleanup(clipFile);
    const msg = err instanceof Error ? err.message : "Download failed";
    if (msg === "client disconnected") return;
    req.log?.error({ err, videoId }, "beat download failed");
    if (!res.headersSent) res.status(500).json({ error: msg });
    else if (!res.writableEnded) res.end();
  }
});

export default router;
