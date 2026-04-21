import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { db, beatChannelsTable } from "@workspace/db";
import { AddChannelBody, RemoveChannelParams } from "@workspace/api-zod";
import { resolveChannelInfo, searchChannels, fetchRecentVideos } from "../lib/youtube";

// yt-dlp is installed at the workspace root via `uv add yt-dlp`.
// __dirname in the built bundle = <workspace>/artifacts/api-server/dist
// so three "../" steps reach the workspace root.
const YTDLP =
  process.env.YTDLP_PATH ??
  path.resolve(__dirname, "../../../.pythonlibs/bin/yt-dlp");

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

router.get("/beats/:videoId/download", async (req, res): Promise<void> => {
  const { videoId } = req.params;
  const rawTitle = typeof req.query.title === "string" ? req.query.title : videoId;
  const safeName = rawTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 120) || videoId;

  // yt-dlp cannot post-process (MP3 conversion) when streaming to stdout.
  // Write to a named temp file so ffmpeg can convert properly, then stream it.
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `tubefeed-${videoId}-${Date.now()}.mp3`);

  const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };

  try {
    await new Promise<void>((resolve, reject) => {
      const ytdlp = spawn(YTDLP, [
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", tmpFile,
        "--no-playlist",
        "--no-warnings",
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);

      const stderrLines: string[] = [];
      ytdlp.stderr.on("data", (chunk: Buffer) => {
        stderrLines.push(chunk.toString().trim());
        req.log?.debug(`yt-dlp: ${chunk.toString().trim()}`);
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

    if (!fs.existsSync(tmpFile)) {
      res.status(500).json({ error: "Download produced no output" });
      return;
    }

    const stat = fs.statSync(tmpFile);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.mp3"`);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("X-Content-Type-Options", "nosniff");

    const readStream = fs.createReadStream(tmpFile);
    readStream.pipe(res);
    readStream.on("close", cleanup);
    readStream.on("error", (err) => {
      req.log?.error({ err }, "stream error after download");
      cleanup();
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
