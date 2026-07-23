import { useState } from "react";
import { Bookmark, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { VideoCard } from "../components/video-card";
import { VideoSkeleton } from "../components/video-skeleton";
import { DownloadModal } from "../components/download-modal";
import { Header } from "../components/header";
import { useSavedVideos } from "@workspace/api-client-react";
import type { Video } from "@workspace/api-client-react";

export default function Saved() {
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const { savedQuery, savedIds, toggleSave } = useSavedVideos();
  const videos = savedQuery.data ?? [];

  const skeletons = Array.from({ length: 8 });

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Header />

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-display font-bold text-text-main">Saved videos</h1>
        </div>

        {savedQuery.isError && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-6">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-sm text-red-400">Failed to load saved videos.</p>
          </div>
        )}

        {savedQuery.isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {skeletons.map((_, i) => (
              <VideoSkeleton key={i} />
            ))}
          </div>
        )}

        {!savedQuery.isLoading && videos.length === 0 && !savedQuery.isError && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Bookmark className="w-10 h-10 text-border-hover mb-4" />
            <p className="text-lg font-semibold text-text-main mb-2">No saved videos yet</p>
            <p className="text-text-muted text-sm">Tap the bookmark icon on any video to save it here.</p>
          </div>
        )}

        {!savedQuery.isLoading && videos.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {videos.map((video, i) => (
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
                  mp3Ready={video.mp3Ready}
                />
              </motion.div>
            ))}
          </motion.div>
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
