import { useState, useEffect } from "react";
import { Search, Rss, Plus, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { VideoCard } from "../components/video-card";
import { VideoSkeleton } from "../components/video-skeleton";
import { DownloadModal } from "../components/download-modal";
import { Header } from "../components/header";
import { formatViews } from "../lib/utils";
import {
  useListChannels,
  useAddChannel,
  useRemoveChannel,
  useSearchChannels,
  useListVideos,
  useSavedVideos,
  getSearchChannelsQueryKey,
} from "@workspace/api-client-react";
import type { Video, ChannelSearchResult } from "@workspace/api-client-react";

export default function Channels() {
  const queryClient = useQueryClient();
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [channelQuery, setChannelQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(channelQuery.trim()), 400);
    return () => clearTimeout(t);
  }, [channelQuery]);

  const { savedIds, toggleSave } = useSavedVideos();
  const channelsQuery = useListChannels();
  const searchQuery = useSearchChannels(
    { q: debouncedQuery },
    { query: { queryKey: getSearchChannelsQueryKey({ q: debouncedQuery }), enabled: debouncedQuery.length > 1 } },
  );
  const videosQuery = useListVideos();

  const addChannel = useAddChannel({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
        queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
        setChannelQuery("");
      },
    },
  });
  const removeChannel = useRemoveChannel({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
        queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      },
    },
  });

  const subscribedIds = new Set((channelsQuery.data ?? []).map((c) => c.youtubeChannelId));

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Header />

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Add a channel */}
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            <input
              value={channelQuery}
              onChange={(e) => setChannelQuery(e.target.value)}
              placeholder="Search for a channel to follow…"
              className="w-full h-10 pl-9 pr-4 bg-background border border-border rounded-xl text-text-main text-sm placeholder:text-text-muted focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {debouncedQuery.length > 1 && (
            <div className="max-w-md space-y-1.5">
              {searchQuery.isLoading && (
                <p className="text-xs text-text-muted px-1">Searching…</p>
              )}
              {!searchQuery.isLoading && (searchQuery.data ?? []).length === 0 && (
                <p className="text-xs text-text-muted px-1">No channels found.</p>
              )}
              {(searchQuery.data ?? []).map((result: ChannelSearchResult) => {
                const alreadyAdded = subscribedIds.has(result.youtubeChannelId);
                return (
                  <div
                    key={result.youtubeChannelId}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-surface border border-border"
                  >
                    <img
                      src={result.thumbnailUrl ?? undefined}
                      alt={result.name}
                      className="w-8 h-8 rounded-full object-cover bg-surface-hover shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-text-main truncate">{result.name}</p>
                      {result.subscriberCount && (
                        <p className="text-xs text-text-muted">{formatViews(result.subscriberCount)} subscribers</p>
                      )}
                    </div>
                    <button
                      disabled={alreadyAdded || addChannel.isPending}
                      onClick={() => addChannel.mutate({ data: { youtubeChannelId: result.youtubeChannelId } })}
                      className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {alreadyAdded ? "Following" : "Follow"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Subscribed channels */}
        {(channelsQuery.data ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {channelsQuery.data!.map((channel) => (
              <div
                key={channel.id}
                className="group flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-full bg-surface border border-border"
              >
                <img
                  src={channel.thumbnailUrl ?? undefined}
                  alt={channel.name}
                  className="w-6 h-6 rounded-full object-cover bg-surface-hover shrink-0"
                />
                <span className="text-xs font-semibold text-text-main">{channel.name}</span>
                <button
                  onClick={() => removeChannel.mutate({ id: channel.id })}
                  className="text-text-muted hover:text-red-400 transition-colors"
                  aria-label={`Unfollow ${channel.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Feed */}
        {channelsQuery.data?.length === 0 && !channelsQuery.isLoading && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Rss className="w-10 h-10 text-border-hover mb-4" />
            <p className="text-lg font-semibold text-text-main mb-2">No channels followed yet</p>
            <p className="text-text-muted text-sm">Search for a channel above to start seeing its videos here.</p>
          </div>
        )}

        {(videosQuery.isLoading || channelsQuery.isLoading) && (channelsQuery.data?.length ?? 0) > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <VideoSkeleton key={i} />)}
          </div>
        )}

        {!videosQuery.isLoading && (videosQuery.data ?? []).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videosQuery.data!.map((video, i) => (
              <motion.div
                key={video.videoId}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.5) }}
              >
                <VideoCard
                  video={video}
                  onClick={setSelectedVideo}
                  isSaved={savedIds.has(video.videoId)}
                  onToggleSave={toggleSave}
                />
              </motion.div>
            ))}
          </div>
        )}
      </main>

      <AnimatePresence>
        {selectedVideo && (
          <DownloadModal
            key={selectedVideo.videoId}
            video={selectedVideo}
            onClose={() => setSelectedVideo(null)}
            isSaved={savedIds.has(selectedVideo.videoId)}
            onToggleSave={toggleSave}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
