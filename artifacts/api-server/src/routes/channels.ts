import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, channelsTable } from "@workspace/db";
import {
  AddChannelBody,
  RemoveChannelParams,
  ListChannelsResponse,
  SearchChannelsQueryParams,
  SearchChannelsResponse,
} from "@workspace/api-zod";
import { resolveChannelInfo, searchChannels } from "../lib/youtube";

const router: IRouter = Router();

router.get("/channels/search", async (req, res): Promise<void> => {
  const queryParsed = SearchChannelsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: queryParsed.error.message });
    return;
  }

  const { q } = queryParsed.data;
  if (!q || q.trim().length === 0) {
    res.json([]);
    return;
  }

  const results = await searchChannels(q.trim());
  res.json(SearchChannelsResponse.parse(results));
});

router.get("/channels", async (_req, res): Promise<void> => {
  const channels = await db
    .select()
    .from(channelsTable)
    .orderBy(channelsTable.addedAt);
  res.json(ListChannelsResponse.parse(channels));
});

router.post("/channels", async (req, res): Promise<void> => {
  const parsed = AddChannelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { youtubeChannelId } = parsed.data;

  let channelInfo;
  try {
    channelInfo = await resolveChannelInfo(youtubeChannelId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to resolve channel";
    res.status(400).json({ error: message });
    return;
  }

  const existing = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.youtubeChannelId, channelInfo.id));

  if (existing.length > 0) {
    res.status(400).json({ error: "Channel already added" });
    return;
  }

  const [channel] = await db
    .insert(channelsTable)
    .values({
      youtubeChannelId: channelInfo.id,
      name: channelInfo.name,
      thumbnailUrl: channelInfo.thumbnailUrl,
    })
    .returning();

  res.status(201).json(channel);
});

router.delete("/channels/:id", async (req, res): Promise<void> => {
  const params = RemoveChannelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(channelsTable)
    .where(eq(channelsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
