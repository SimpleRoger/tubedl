import { useState, useEffect } from "react";
import {
  Download, Scissors, Film, Music2, X, Loader2,
  AlertCircle, CheckCircle, ExternalLink, Clock, Eye, Bookmark,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatViews, formatDuration } from "../lib/utils";
import { useVideoDownload, type DlFormat } from "../hooks/use-video-download";
import { formatDistanceToNow } from "date-fns";
import type { Video } from "@workspace/api-client-react";

interface DownloadModalProps {
  video: Video;
  onClose: () => void;
  isSaved?: boolean;
  onToggleSave?: (video: Video) => void;
}

export function DownloadModal({ video, onClose, isSaved, onToggleSave }: DownloadModalProps) {
  const [format, setFormat] = useState<DlFormat>("mp4");
  const [clipMode, setClipMode] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const { state: dlState, start: startDownload, reset: resetDownload } = useVideoDownload();

  useEffect(() => {
    resetDownload();
    setClipMode(false);
    setStartTime("");
    setEndTime("");
    setFormat("mp4");
  }, [video.videoId, resetDownload]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const handleDownload = () => {
    startDownload(
      video.videoId,
      video.title,
      format,
      clipMode ? startTime || undefined : undefined,
      clipMode ? endTime || undefined : undefined,
    );
  };

  const duration = formatDuration(video.duration);
  const relativeDate = (() => {
    try {
      return formatDistanceToNow(new Date(video.publishedAt), { addSuffix: true });
    } catch {
      return video.publishedAt;
    }
  })();

  const isIdle = dlState.status === "idle";
  const isRunning = dlState.status === "running";
  const isDone = dlState.status === "done";
  const isError = dlState.status === "error";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 10 }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
        className="relative z-10 w-full max-w-5xl max-h-[92vh] flex flex-col lg:flex-row bg-surface border border-border rounded-2xl overflow-hidden shadow-[0_32px_80px_-16px_rgba(0,0,0,0.7)]"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-20 p-1.5 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/80 transition-colors backdrop-blur-sm"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Save button */}
        {onToggleSave && (
          <button
            onClick={() => onToggleSave(video)}
            title={isSaved ? "Remove from saved" : "Save video"}
            className={`absolute top-3 right-14 z-20 p-1.5 rounded-full backdrop-blur-sm transition-colors ${
              isSaved
                ? "bg-primary text-white"
                : "bg-black/50 text-white/70 hover:text-white hover:bg-black/80"
            }`}
          >
            <Bookmark className="w-5 h-5" fill={isSaved ? "currentColor" : "none"} />
          </button>
        )}

        {/* ── Left: Video Player ── */}
        <div className="flex flex-col w-full lg:w-[58%] shrink-0 lg:border-r border-border overflow-y-auto">
          <div className="relative w-full aspect-video bg-black shrink-0">
            <iframe
              src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1&rel=0`}
              title={video.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>

          <div className="p-4 space-y-2">
            <h2 className="text-text-main font-bold text-base leading-snug">{video.title}</h2>
            <div className="flex items-center gap-2 flex-wrap text-xs text-text-muted">
              <span className="font-semibold text-text-main/80">{video.channelName}</span>
              {video.viewCount && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{formatViews(video.viewCount)}</span>
                </>
              )}
              {duration && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{duration}</span>
                </>
              )}
              <span>·</span>
              <span>{relativeDate}</span>
            </div>
            <a
              href={`https://youtube.com/watch?v=${video.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Open on YouTube
            </a>
          </div>
        </div>

        {/* ── Right: Download Panel ── */}
        <div className="flex flex-col w-full lg:w-[42%] p-5 gap-5 overflow-y-auto">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Download className="w-3.5 h-3.5 text-primary" />
            </div>
            <h3 className="font-bold text-text-main text-sm">Download</h3>
          </div>

          {/* Format picker */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">Format</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setFormat("mp4")}
                className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition-all ${
                  format === "mp4"
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "bg-background border-border text-text-muted hover:border-border-hover hover:text-text-main"
                }`}
              >
                <Film className="w-4 h-4 shrink-0" />
                <span>MP4 Video</span>
              </button>
              <button
                onClick={() => setFormat("mp3")}
                className={`flex items-center gap-2 px-3 py-3 rounded-xl border text-sm font-semibold transition-all ${
                  format === "mp3"
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "bg-background border-border text-text-muted hover:border-border-hover hover:text-text-main"
                }`}
              >
                <Music2 className="w-4 h-4 shrink-0" />
                <span>MP3 Audio</span>
              </button>
            </div>
            {format === "mp4" && (
              <p className="text-xs text-text-muted">Best quality up to 1080p, merged MP4.</p>
            )}
            {format === "mp3" && (
              <p className="text-xs text-text-muted">Highest quality audio extracted as MP3.</p>
            )}
          </div>

          {/* Clip toggle */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-1.5">
                <Scissors className="w-3.5 h-3.5" />Clip (optional)
              </p>
              <button
                onClick={() => {
                  setClipMode((p) => !p);
                  setStartTime("");
                  setEndTime("");
                }}
                className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all ${
                  clipMode
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "border-border text-text-muted hover:border-border-hover hover:text-text-main"
                }`}
              >
                {clipMode ? "On" : "Off"}
              </button>
            </div>

            <AnimatePresence initial={false}>
              {clipMode && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 pt-1">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-text-muted uppercase tracking-widest font-semibold">Start</label>
                      <input
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        placeholder="e.g. 1:02"
                        className="w-full h-9 px-3 bg-background border border-border rounded-lg text-text-main text-sm focus:outline-none focus:border-primary/50 transition-colors font-mono"
                      />
                    </div>
                    <span className="text-text-muted mt-5 shrink-0">→</span>
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-text-muted uppercase tracking-widest font-semibold">End</label>
                      <input
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        placeholder="e.g. 3:45"
                        className="w-full h-9 px-3 bg-background border border-border rounded-lg text-text-main text-sm focus:outline-none focus:border-primary/50 transition-colors font-mono"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-text-muted mt-2">Leave blank to download the full video.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Download button + status */}
          <div className="space-y-3 mt-auto">
            {isIdle && (
              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold text-sm transition-all shadow-lg shadow-primary/20 active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                {clipMode && (startTime || endTime)
                  ? `Download Clip · ${format.toUpperCase()}`
                  : `Download · ${format.toUpperCase()}`}
              </button>
            )}

            {isRunning && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-amber-400 font-medium">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {dlState.message}
                  </span>
                  <span className="text-text-muted tabular-nums">{dlState.pct}%</span>
                </div>
                <div className="w-full h-1.5 bg-surface-hover rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-amber-400 rounded-full"
                    animate={{ width: `${dlState.pct}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            )}

            {isDone && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 py-3 px-4 rounded-xl bg-green-500/10 border border-green-500/20">
                  <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-green-400">Download started</p>
                    <p className="text-xs text-text-muted truncate">{dlState.filename}</p>
                  </div>
                </div>
                <button
                  onClick={() => { resetDownload(); }}
                  className="w-full py-2.5 rounded-xl border border-border text-text-muted hover:text-text-main hover:border-border-hover text-sm font-medium transition-colors"
                >
                  Download another format
                </button>
              </div>
            )}

            {isError && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 py-3 px-4 rounded-xl bg-red-500/10 border border-red-500/20">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-400">Download failed</p>
                    <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{dlState.error}</p>
                  </div>
                </div>
                <button
                  onClick={() => resetDownload()}
                  className="w-full py-2.5 rounded-xl border border-border text-text-muted hover:text-text-main hover:border-border-hover text-sm font-medium transition-colors"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
