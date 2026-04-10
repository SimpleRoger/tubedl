import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, savedVideosTable } from "@workspace/db";
import { fetchVideoById } from "../lib/youtube";

const router: IRouter = Router();

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

export default router;
