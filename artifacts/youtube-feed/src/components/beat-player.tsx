import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronDown, ChevronUp, ExternalLink, Music2,
  Sparkles, Loader2, FileText,
} from "lucide-react";
import type { Video } from "@workspace/api-client-react";
import { formatDuration } from "../lib/utils";
import { useSimilarBeats } from "../hooks/use-beats";
import { BeatCard } from "./beat-card";

const LYRICS_KEY = (videoId: string) => `tubefeed-lyrics-${videoId}`;
const BEAT_META_KEY = (videoId: string) => `tubefeed-beat-meta-${videoId}`;

interface BeatPlayerProps {
  beat: Video | null;
  onClose: () => void;
  onBeatSelect: (beat: Video) => void;
}

export function BeatPlayer({ beat, onClose, onBeatSelect }: BeatPlayerProps) {
  const isOpen = beat !== null;
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const lyricsRef = useRef<HTMLTextAreaElement>(null);

  const { data: similarBeats, isLoading: similarLoading } = useSimilarBeats(
    beat?.videoId ?? "",
    beat?.title ?? "",
    isOpen
  );

  // Load saved lyrics when beat changes
  useEffect(() => {
    if (beat) {
      const saved = localStorage.getItem(LYRICS_KEY(beat.videoId)) ?? "";
      setLyrics(saved);
      setVideoExpanded(false);
    }
  }, [beat?.videoId]);

  // Save beat metadata whenever beat changes (so Lyrics page can display it)
  useEffect(() => {
    if (!beat) return;
    localStorage.setItem(BEAT_META_KEY(beat.videoId), JSON.stringify({
      videoId: beat.videoId,
      title: beat.title,
      channelName: beat.channelName,
      thumbnailUrl: beat.thumbnailUrl,
    }));
  }, [beat?.videoId]);

  // Save lyrics on change (debounced via useEffect)
  useEffect(() => {
    if (!beat) return;
    const timer = setTimeout(() => {
      localStorage.setItem(LYRICS_KEY(beat.videoId), lyrics);
      localStorage.setItem(`tubefeed-beat-time-${beat.videoId}`, Date.now().toString());
    }, 500);
    return () => clearTimeout(timer);
  }, [lyrics, beat?.videoId]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && isOpen) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const handleSimilarClick = useCallback((similar: Video) => {
    onBeatSelect(similar);
  }, [onBeatSelect]);

  if (!beat) return null;

  const duration = formatDuration(beat.duration);
  const wordCount = lyrics.trim().split(/\s+/).filter(Boolean).length;
  const lineCount = lyrics.split("\n").length;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/85 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="relative z-10 w-full max-w-5xl max-h-[94vh] bg-surface border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col lg:flex-row shadow-[0_32px_80px_-16px_rgba(0,0,0,0.7)]"
          >
            {/* Close */}
            <button onClick={onClose} className="absolute top-3 right-3 z-20 p-1.5 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/80 transition-colors">
              <X className="w-5 h-5" />
            </button>

            {/* Left — Lyrics Notepad */}
            <div className="flex flex-col flex-1 min-h-0">
              {/* Beat Header */}
              <div className="px-5 pt-5 pb-3 border-b border-border shrink-0">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-border">
                    <img src={beat.thumbnailUrl} alt={beat.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1 pr-8">
                    <h2 className="text-text-main font-bold text-sm leading-snug line-clamp-2">{beat.title}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Music2 className="w-3 h-3 text-primary shrink-0" />
                      <p className="text-xs text-text-muted truncate">{beat.channelName}</p>
                      {duration && <span className="text-xs text-text-muted shrink-0">· {duration}</span>}
                    </div>
                  </div>
                </div>

                {/* Collapsible video */}
                <button
                  onClick={() => setVideoExpanded((p) => !p)}
                  className="mt-3 flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors"
                >
                  {videoExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {videoExpanded ? "Hide video" : "Show video"}
                </button>

                {/* iframe is ALWAYS in the DOM so autoplay fires immediately on open.
                    Height animates to show/hide visually — audio keeps playing either way. */}
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: videoExpanded ? "auto" : 0, opacity: videoExpanded ? 1 : 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden mt-2"
                >
                  <div className="aspect-video rounded-xl overflow-hidden bg-black">
                    <iframe
                      key={beat.videoId}
                      src={`https://www.youtube.com/embed/${beat.videoId}?autoplay=1&rel=0`}
                      title={beat.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="w-full h-full"
                    />
                  </div>
                </motion.div>
              </div>

              {/* Lyrics Notepad */}
              <div className="flex flex-col flex-1 p-5 min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted">Lyrics</span>
                  </div>
                  {lyrics && (
                    <span className="text-[10px] text-text-muted">
                      {wordCount} words · {lineCount} lines
                    </span>
                  )}
                </div>
                <textarea
                  ref={lyricsRef}
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  placeholder={"Write your lyrics here…\n\nYour words auto-save per beat."}
                  className="flex-1 w-full bg-background border border-border rounded-xl p-4 text-text-main text-sm leading-relaxed resize-none focus:outline-none focus:border-primary/50 placeholder:text-text-muted/40 font-mono min-h-[200px]"
                  spellCheck={false}
                />
                <a
                  href={`https://youtube.com/watch?v=${beat.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors self-start"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open on YouTube
                </a>
              </div>
            </div>

            {/* Right — Similar Beats */}
            <div className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-border flex flex-col max-h-[40vh] lg:max-h-full overflow-hidden">
              <div className="px-4 pt-4 pb-2 shrink-0 border-b border-border">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[11px] font-bold uppercase tracking-widest text-text-muted">Similar Beats</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                {similarLoading && (
                  <div className="flex items-center justify-center py-8 gap-2 text-text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Finding similar beats…</span>
                  </div>
                )}

                {!similarLoading && (!similarBeats || similarBeats.length === 0) && (
                  <p className="text-sm text-text-muted text-center py-8">No similar beats found</p>
                )}

                {similarBeats?.map((similar) => (
                  <BeatCard
                    key={similar.videoId}
                    beat={similar}
                    isPlaying={false}
                    onClick={handleSimilarClick}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
