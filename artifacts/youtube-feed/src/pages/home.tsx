import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Download, Scissors, Loader2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { VideoCard } from "../components/video-card";
import { VideoSkeleton } from "../components/video-skeleton";
import { DownloadModal } from "../components/download-modal";
import { Header } from "../components/header";
import { customFetch, useSavedVideos } from "@workspace/api-client-react";
import type { Video } from "@workspace/api-client-react";

export default function Home() {
  const [query, setQuery] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [results, setResults] = useState<Video[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { savedIds, toggleSave } = useSavedVideos();

  const handleSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);
    setResults([]);
    try {
      const data = await customFetch<Video[]>(`/api/videos/search?q=${encodeURIComponent(trimmed)}&maxResults=24`);
      setResults(data);
    } catch (err: any) {
      setSearchError(err.message ?? "Search failed");
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch(inputValue);
  };

  // Focus search on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const skeletons = Array.from({ length: 8 });

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Header>
        {/* Search bar */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Search YouTube videos…"
              className="w-full h-10 pl-9 pr-4 bg-background border border-border rounded-xl text-text-main text-sm placeholder:text-text-muted focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={!inputValue.trim() || isSearching}
            className="h-10 px-5 bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all shrink-0"
          >
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
          </button>
        </form>
      </Header>

      {/* Main content */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-8">

        {/* Empty / hero state */}
        {!hasSearched && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center justify-center py-24 text-center"
          >
            <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6 shadow-2xl">
              <Download className="w-9 h-9 text-primary" />
            </div>
            <h1 className="text-4xl font-display font-bold text-text-main mb-3 tracking-tight">
              Search. Download. Clip.
            </h1>
            <p className="text-text-muted max-w-md text-lg leading-relaxed">
              Find any YouTube video, then download it as MP4 or MP3 — or clip a specific segment.
            </p>
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl w-full">
              {[
                { icon: <Search className="w-5 h-5" />, label: "Search", desc: "Find any video by title, channel, or topic" },
                { icon: <Download className="w-5 h-5" />, label: "Download", desc: "Save as MP4 video or MP3 audio" },
                { icon: <Scissors className="w-5 h-5" />, label: "Clip", desc: "Trim to just the part you want" },
              ].map((item) => (
                <div key={item.label} className="bg-surface border border-border rounded-xl p-4 text-left">
                  <div className="text-primary mb-2">{item.icon}</div>
                  <p className="font-semibold text-text-main text-sm mb-1">{item.label}</p>
                  <p className="text-xs text-text-muted leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Search error */}
        {searchError && !isSearching && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-6">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-sm text-red-400">{searchError}</p>
          </div>
        )}

        {/* Loading skeletons */}
        {isSearching && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {skeletons.map((_, i) => (
              <VideoSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Results */}
        {!isSearching && hasSearched && results.length === 0 && !searchError && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Search className="w-10 h-10 text-border-hover mb-4" />
            <p className="text-lg font-semibold text-text-main mb-2">No results for "{query}"</p>
            <p className="text-text-muted text-sm">Try a different search term.</p>
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center justify-between mb-5">
              <p className="text-sm text-text-muted">
                <span className="text-text-main font-semibold">{results.length}</span> results for
                {" "}<span className="text-primary">"{query}"</span>
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {results.map((video, i) => (
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
          </motion.div>
        )}
      </main>

      {/* Download modal */}
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
