import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const savedVideosTable = pgTable("saved_videos", {
  id: serial("id").primaryKey(),
  videoId: text("video_id").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  thumbnailUrl: text("thumbnail_url").notNull(),
  channelId: text("channel_id").notNull(),
  channelName: text("channel_name").notNull(),
  channelThumbnailUrl: text("channel_thumbnail_url"),
  viewCount: text("view_count"),
  duration: text("duration"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSavedVideoSchema = createInsertSchema(savedVideosTable).omit({
  id: true,
  savedAt: true,
});
export type InsertSavedVideo = z.infer<typeof insertSavedVideoSchema>;
export type SavedVideo = typeof savedVideosTable.$inferSelect;
