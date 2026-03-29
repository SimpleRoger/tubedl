import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Youtube, Loader2, AlertCircle, Search, Plus, Users } from "lucide-react";
import { useAddChannel } from "../hooks/use-channels";
import { useSearchChannels } from "../hooks/use-search-channels";

interface AddChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatSubs(count: string | null | undefined): string {
  if (!count) return "";
  const n = parseInt(count, 10);
  if (isNaN(n)) return "";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M subscribers";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K subscribers";
  return n + " subscribers";
}

export function AddChannelModal({ isOpen, onClose }: AddChannelModalProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addMutation = useAddChannel();
  const { data: results, isLoading: isSearching } = useSearchChannels(debouncedQuery);

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setDebouncedQuery("");
      setErrorMsg("");
      setAddingId(null);
      addMutation.reset();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleAdd = (youtubeChannelId: string) => {
    if (addingId) return;
    setErrorMsg("");
    setAddingId(youtubeChannelId);
    addMutation.mutate(
      { data: { youtubeChannelId } },
      {
        onSuccess: () => {
          onClose();
        },
        onError: (error: any) => {
          const msg =
            error?.response?.data?.error ||
            error?.message ||
            "Failed to add channel.";
          setErrorMsg(msg);
          setAddingId(null);
        },
      }
    );
  };

  const showResults = debouncedQuery.length > 0 && results && results.length > 0;
  const showEmpty = debouncedQuery.length > 0 && !isSearching && results?.length === 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 pt-[10vh]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: -8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: -8 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="bg-surface border border-border rounded-2xl w-full max-w-lg relative z-10 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 text-primary shrink-0">
                <Youtube className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-text-main">Add Channel</h2>
                <p className="text-xs text-text-muted">Search by name or paste a @handle</p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-text-muted hover:text-white hover:bg-surface-hover rounded-full transition-colors outline-none"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search input */}
            <div className="px-5 pt-4 pb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for a channel e.g. Hamza"
                  className="w-full bg-background border-2 border-border focus:border-primary text-text-main rounded-xl pl-9 pr-4 py-3 outline-none transition-colors placeholder:text-text-muted text-sm"
                  disabled={!!addingId}
                />
                {isSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin" />
                )}
              </div>

              {/* Error */}
              <AnimatePresence>
                {errorMsg && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-red-400 text-xs flex items-start gap-1.5 mt-2 overflow-hidden"
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Results list */}
            <div className="px-2 pb-3 max-h-80 overflow-y-auto">
              {/* Prompt state */}
              {!debouncedQuery && (
                <div className="flex flex-col items-center justify-center py-8 text-center text-text-muted">
                  <Search className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">Start typing to search for channels</p>
                </div>
              )}

              {/* Empty state */}
              {showEmpty && (
                <div className="flex flex-col items-center justify-center py-8 text-center text-text-muted">
                  <Youtube className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">No channels found for "{debouncedQuery}"</p>
                </div>
              )}

              {/* Results */}
              <AnimatePresence>
                {showResults && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col gap-1"
                  >
                    {results!.map((channel) => {
                      const isAdding = addingId === channel.youtubeChannelId;
                      return (
                        <button
                          key={channel.youtubeChannelId}
                          onClick={() => handleAdd(channel.youtubeChannelId)}
                          disabled={!!addingId}
                          className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-surface-hover transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-primary group w-full"
                        >
                          {/* Avatar */}
                          <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-border flex items-center justify-center">
                            {channel.thumbnailUrl ? (
                              <img
                                src={channel.thumbnailUrl}
                                alt={channel.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Youtube className="w-5 h-5 text-text-muted" />
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-text-main truncate">
                              {channel.name}
                            </p>
                            {channel.subscriberCount && (
                              <p className="text-xs text-text-muted flex items-center gap-1 mt-0.5">
                                <Users className="w-3 h-3" />
                                {formatSubs(channel.subscriberCount)}
                              </p>
                            )}
                          </div>

                          {/* Add button */}
                          <div className="shrink-0">
                            {isAdding ? (
                              <Loader2 className="w-5 h-5 text-primary animate-spin" />
                            ) : (
                              <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/30 group-hover:bg-primary group-hover:border-primary flex items-center justify-center transition-colors">
                                <Plus className="w-4 h-4 text-primary group-hover:text-white transition-colors" />
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
