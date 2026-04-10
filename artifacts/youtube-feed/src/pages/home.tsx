import { useState } from "react";
import { Link } from "wouter";
import { Plus, Youtube, AlertCircle, RefreshCw, Music2, FileText, Mic, Clock, Flame } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { useVideos } from "../hooks/use-videos";
import { useChannels } from "../hooks/use-channels";
import { VideoCard } from "../components/video-card";
import { VideoSkeleton } from "../components/video-skeleton";
import { ChannelSidebar } from "../components/channel-sidebar";
import { AddChannelModal } from "../components/add-channel-modal";
import { VideoPlayerModal } from "../components/video-player-modal";
import type { Video } from "@workspace/api-client-react";

export default function Home() {
  const [selectedChannelId, setSelectedChannelId] = useState<number | undefined>();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeVideo, setActiveVideo] = useState<Video | null>(null);
  const [order, setOrder] = useState<"recent" | "popular">("recent");
  
  const { data: channels } = useChannels();
  const { data: videos, isLoading: isVideosLoading, isError, error, refetch } = useVideos(selectedChannelId, order);

  // Check if it's an API Key error (usually contains 'key' in a 500 error from Youtube Data API)
  const isKeyError = isError && String(error).toLowerCase().includes("key");

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      {/* Topbar */}
      <header className="h-16 border-b border-border glass-panel sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <img 
              src={`${import.meta.env.BASE_URL}images/logo.png`} 
              className="w-9 h-9 rounded-xl shadow-lg" 
              alt="Logo" 
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <h1 className="font-display font-bold text-xl sm:text-2xl tracking-tight text-white flex items-center">
              Tube<span className="text-primary ml-0.5">Feed</span>
            </h1>
          </div>
          {/* Tabs */}
          <nav className="flex items-center gap-1 bg-surface/60 border border-border rounded-xl px-1.5 py-1">
            <span className="px-3 py-1 rounded-lg text-sm font-semibold bg-primary/15 text-primary border border-primary/20">
              Feed
            </span>
            <Link href="/beats">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer">
                <Music2 className="w-3.5 h-3.5" />Beats
              </span>
            </Link>
            <Link href="/lyrics">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer">
                <FileText className="w-3.5 h-3.5" />Lyrics
              </span>
            </Link>
            <Link href="/recordings">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer">
                <Mic className="w-3.5 h-3.5" />Recordings
              </span>
            </Link>
          </nav>
        </div>
        
        <button 
          onClick={() => setIsAddModalOpen(true)} 
          className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-[0_0_15px_rgba(255,0,0,0.3)] hover:shadow-[0_0_20px_rgba(255,0,0,0.5)] flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Plus className="w-4 h-4" /> 
          <span className="hidden sm:inline">Add Channel</span>
        </button>
      </header>

      <div className="flex-1 flex max-w-[1800px] w-full mx-auto relative">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-72 shrink-0 border-r border-border p-6 h-[calc(100vh-4rem)] sticky top-16 overflow-y-auto">
          <ChannelSidebar 
            layout="vertical" 
            selectedId={selectedChannelId} 
            onSelect={setSelectedChannelId} 
            onAddClick={() => setIsAddModalOpen(true)}
          />
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0">
          
          {/* Mobile Horizontal Channels List */}
          <div className="block lg:hidden mb-6 overflow-x-auto pb-4 -mx-4 px-4 sm:-mx-6 sm:px-6 hide-scrollbar relative">
            <ChannelSidebar 
              layout="horizontal" 
              selectedId={selectedChannelId} 
              onSelect={setSelectedChannelId} 
              onAddClick={() => setIsAddModalOpen(true)}
            />
          </div>

          <div className="mb-8 flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-2xl font-display font-bold text-text-main">
              {selectedChannelId 
                ? channels?.find(c => c.id === selectedChannelId)?.name || "Channel Videos" 
                : order === "popular" ? "Most Popular" : "Recent Uploads"}
            </h2>

            <div className="flex items-center gap-2">
              {/* Recent / Popular toggle */}
              {(channels?.length ?? 0) > 0 && (
                <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1">
                  <button
                    onClick={() => setOrder("recent")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      order === "recent"
                        ? "bg-primary text-white shadow"
                        : "text-text-muted hover:text-text-main hover:bg-surface-hover"
                    )}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    Recent
                  </button>
                  <button
                    onClick={() => setOrder("popular")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      order === "popular"
                        ? "bg-primary text-white shadow"
                        : "text-text-muted hover:text-text-main hover:bg-surface-hover"
                    )}
                  >
                    <Flame className="w-3.5 h-3.5" />
                    Popular
                  </button>
                </div>
              )}

              <button 
                onClick={() => refetch()}
                disabled={isVideosLoading}
                className="p-2 text-text-muted hover:text-white rounded-full hover:bg-surface-hover transition-colors disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                title="Refresh feed"
              >
                <RefreshCw className={cn("w-5 h-5", isVideosLoading && "animate-spin")} />
              </button>
            </div>
          </div>

          {/* Error State */}
          {isError ? (
            <motion.div 
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="p-8 sm:p-12 bg-surface rounded-2xl border border-red-500/20 text-center max-w-2xl mx-auto mt-10 shadow-xl"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-2xl font-display font-bold text-text-main mb-3">
                {isKeyError ? "API Configuration Required" : "Failed to load videos"}
              </h3>
              <p className="text-text-muted mb-6 text-lg">
                {isKeyError 
                  ? "It looks like the YouTube Data API key is not configured. Please add your key to the Replit Secrets to fetch live data."
                  : "We encountered an unexpected error while fetching the feed. Please try again later."}
              </p>
              {!isKeyError && (
                <button onClick={() => refetch()} className="px-6 py-3 bg-surface-hover hover:bg-border rounded-xl font-medium transition-colors">
                  Try Again
                </button>
              )}
            </motion.div>
          ) : 
          
          /* Loading State */
          isVideosLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-8 sm:gap-x-6">
              {Array.from({ length: 10 }).map((_, i) => (
                <VideoSkeleton key={i} />
              ))}
            </div>
          ) : 
          
          /* Empty State (No Channels) */
          channels?.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-20 sm:py-32 text-center px-4"
            >
              <div className="w-24 h-24 bg-surface rounded-full flex items-center justify-center mb-6 shadow-2xl border border-border">
                <Youtube className="w-12 h-12 text-border-hover" />
              </div>
              <h2 className="text-3xl font-display font-bold text-text-main mb-3">Your Feed is Empty</h2>
              <p className="text-text-muted max-w-md mb-8 text-lg">
                Build your personalized YouTube experience. Add your favorite creators to see their latest videos all in one place.
              </p>
              <button 
                onClick={() => setIsAddModalOpen(true)} 
                className="bg-primary hover:bg-primary-hover text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 outline-none focus-visible:ring-4 focus-visible:ring-primary/50"
              >
                Add Your First Channel
              </button>
            </motion.div>
          ) : 
          
          /* Empty State (No Videos found for channels) */
          videos?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4">
              <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-4">
                <Youtube className="w-8 h-8 text-text-muted/50" />
              </div>
              <h3 className="text-xl font-display font-semibold text-text-main mb-2">No recent videos</h3>
              <p className="text-text-muted">
                {selectedChannelId 
                  ? "This channel hasn't uploaded anything in the last 3 months." 
                  : "None of your favorite channels have uploaded recently."}
              </p>
            </div>
          ) : 
          
          /* Success Feed */
          (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-8 sm:gap-x-6">
              {videos?.map((video, index) => (
                <motion.div
                  key={`${video.videoId}-${index}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.5), ease: "easeOut" }}
                >
                  <VideoCard video={video} onClick={setActiveVideo} />
                </motion.div>
              ))}
            </div>
          )}
        </main>
      </div>

      <AddChannelModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />

      <VideoPlayerModal
        video={activeVideo}
        onClose={() => setActiveVideo(null)}
      />
    </div>
  );
}
