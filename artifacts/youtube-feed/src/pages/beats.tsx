import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Plus, Music2, AlertCircle, RefreshCw, Tv2, FileText, Search, X, SlidersHorizontal, Loader2, Mic, Bookmark } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useBeats, useSearchBeats, type BeatSortOrder } from "../hooks/use-beats";
import { useBeatChannels, useRemoveBeatChannel } from "../hooks/use-beat-channels";
import { BeatCard } from "../components/beat-card";
import { BeatPlayer } from "../components/beat-player";
import { AddBeatChannelModal } from "../components/add-beat-channel-modal";
import type { Video } from "@workspace/api-client-react";

const SORT_OPTIONS: { value: BeatSortOrder; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "date", label: "Latest" },
  { value: "viewCount", label: "Popular" },
];

export default function Beats() {
  const [selectedChannelId, setSelectedChannelId] = useState<number | undefined>();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeBeat, setActiveBeat] = useState<Video | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<BeatSortOrder>("relevance");
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: channels } = useBeatChannels();
  const { data: beats, isLoading: beatsLoading, isError, refetch } = useBeats(selectedChannelId);
  const { data: searchResults, isLoading: searchLoading } = useSearchBeats(searchQuery, sortOrder);
  const removeBeatChannel = useRemoveBeatChannel();

  const isSearchMode = searchQuery.trim().length >= 2;

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchQuery(searchInput), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const clearSearch = () => { setSearchInput(""); setSearchQuery(""); searchRef.current?.focus(); };

  const handleBeatSelect = useCallback((beat: Video) => setActiveBeat(beat), []);

  const displayBeats = isSearchMode ? searchResults : beats;
  const isLoading = isSearchMode ? searchLoading : beatsLoading;

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
          <nav className="flex items-center gap-1 bg-surface/60 border border-border rounded-xl px-1.5 py-1">
            <Link href="/">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer">
                <Tv2 className="w-3.5 h-3.5" />Feed
              </span>
            </Link>
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-semibold bg-primary/15 text-primary border border-primary/20">
              <Music2 className="w-3.5 h-3.5" />Beats
            </span>
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
            <Link href="/saved">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer">
                <Bookmark className="w-3.5 h-3.5" />Saved
              </span>
            </Link>
          </nav>
        </div>
      </header>

      {/* Sidebar + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden" style={{ height: 'calc(100vh - 4rem)' }}>
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r border-border flex flex-col bg-surface overflow-y-auto hidden sm:flex">
          <div className="px-4 pt-5 pb-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-text-muted">Beat Channels</span>
            <span className="text-xs text-text-muted bg-background px-1.5 py-0.5 rounded-full border border-border">
              {channels?.length ?? 0}
            </span>
          </div>

          <button
            onClick={() => { setSelectedChannelId(undefined); clearSearch(); }}
            className={`mx-3 mb-1 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              !selectedChannelId && !isSearchMode ? "bg-primary/10 text-primary border border-primary/20" : "text-text-muted hover:text-text-main hover:bg-surface-hover"
            }`}
          >
            <Music2 className="w-4 h-4 shrink-0" />
            All Beats
          </button>

          <div className="flex flex-col gap-0.5 px-3 pb-3">
            {channels?.map((ch) => (
              <div key={ch.id} className="group relative">
                <button
                  onClick={() => { setSelectedChannelId(ch.id === selectedChannelId ? undefined : ch.id); clearSearch(); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${
                    selectedChannelId === ch.id && !isSearchMode ? "bg-primary/10 text-primary border border-primary/20" : "text-text-muted hover:text-text-main hover:bg-surface-hover"
                  }`}
                >
                  {ch.thumbnailUrl ? (
                    <img src={ch.thumbnailUrl} alt={ch.name} className="w-5 h-5 rounded-full shrink-0 object-cover" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-surface-hover shrink-0 flex items-center justify-center text-[10px] font-bold">
                      {ch.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="truncate">{ch.name}</span>
                </button>
                <button
                  onClick={() => removeBeatChannel.mutate(ch.id)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all text-xs px-1.5 py-0.5 rounded bg-surface-hover"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="mx-3 mb-4 flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-text-muted hover:text-primary hover:bg-surface-hover border border-dashed border-border hover:border-primary/30 transition-all mt-auto"
          >
            <Plus className="w-4 h-4" />
            Add Beat Channel
          </button>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 min-h-0">
          {/* Search bar + sort controls */}
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
              <input
                ref={searchRef}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder='Search beats — try "fake mink" or "lofi hip hop"'
                className="w-full pl-10 pr-10 py-3 bg-surface border border-border rounded-xl text-sm text-text-main placeholder:text-text-muted/50 focus:outline-none focus:border-primary/50 transition-colors"
              />
              {searchInput && (
                <button
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              {isSearchMode && searchLoading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted animate-spin" />
              )}
            </div>

            {/* Sort tabs — only visible in search mode */}
            <AnimatePresence>
              {isSearchMode && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <span className="text-xs text-text-muted font-medium">Sort by:</span>
                    <div className="flex items-center gap-1">
                      {SORT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setSortOrder(opt.value)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                            sortOrder === opt.value
                              ? "bg-primary text-white shadow-sm"
                              : "bg-surface border border-border text-text-muted hover:text-text-main hover:border-border-hover"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {searchResults && (
                      <span className="ml-auto text-xs text-text-muted">
                        {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mobile add channel */}
          {!isSearchMode && (
            <div className="flex sm:hidden items-center justify-between">
              <h2 className="text-text-muted text-sm font-medium">
                {channels?.length ? `${channels.length} beat channel${channels.length !== 1 ? "s" : ""}` : "No channels yet"}
              </h2>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          )}

          {/* Empty state — no channels */}
          {!isSearchMode && !isLoading && !isError && (!displayBeats || displayBeats.length === 0) && (
            <div className="flex flex-col items-center justify-center flex-1 text-center py-16">
              <div className="w-20 h-20 rounded-full bg-surface border border-border flex items-center justify-center mb-6">
                <Music2 className="w-9 h-9 text-text-muted/40" />
              </div>
              <h2 className="text-2xl font-bold text-text-main mb-2">No beats yet</h2>
              <p className="text-text-muted max-w-sm mb-8 text-sm leading-relaxed">
                Add beat producers to see their latest uploads, or search above to find any beat on YouTube.
              </p>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-primary/20"
              >
                <Plus className="w-4 h-4" />
                Add Beat Channel
              </button>
            </div>
          )}

          {/* Search empty state */}
          {isSearchMode && !searchLoading && (!searchResults || searchResults.length === 0) && (
            <div className="flex flex-col items-center justify-center flex-1 text-center py-16">
              <Search className="w-10 h-10 text-text-muted/30 mb-4" />
              <p className="text-text-main font-semibold mb-1">No results for "{searchQuery}"</p>
              <p className="text-text-muted text-sm">Try a different search term or sort order</p>
            </div>
          )}

          {/* Error state */}
          {isError && !isSearchMode && (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 py-16">
              <AlertCircle className="w-10 h-10 text-red-400" />
              <p className="text-text-muted">Failed to load beats</p>
              <button onClick={() => refetch()} className="flex items-center gap-2 px-4 py-2 bg-surface-hover rounded-xl text-sm">
                <RefreshCw className="w-4 h-4" /> Retry
              </button>
            </div>
          )}

          {/* Loading skeletons */}
          {isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-surface border border-border animate-pulse" />
              ))}
            </div>
          )}

          {/* Beat list */}
          {!isLoading && displayBeats && displayBeats.length > 0 && (
            <div className="flex flex-col gap-2">
              {isSearchMode && (
                <p className="text-xs text-text-muted pb-1">
                  Showing top results for <span className="text-text-main font-medium">"{searchQuery}"</span>
                </p>
              )}
              {displayBeats.map((beat, index) => (
                <motion.div
                  key={`${beat.videoId}-${index}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
                >
                  <BeatCard
                    beat={beat}
                    isPlaying={activeBeat?.videoId === beat.videoId}
                    onClick={handleBeatSelect}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </main>
      </div>

      <AddBeatChannelModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />

      <BeatPlayer
        beat={activeBeat}
        onClose={() => setActiveBeat(null)}
        onBeatSelect={(beat) => setActiveBeat(beat)}
      />
    </div>
  );
}
