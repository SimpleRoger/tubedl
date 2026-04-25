import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ExternalLink, Sparkles, Loader2, AlertCircle,
  ChevronDown, ChevronUp, Users, Star, Lightbulb,
  FileText, BookOpen, Zap, CheckCircle2, FileSearch,
  Download, CheckCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Video } from "@workspace/api-client-react";
import { formatViews, formatDuration } from "../lib/utils";
import { useVideoDownload } from "../hooks/use-video-download";

interface StructuredSummary {
  tldr: string;
  overview: string;
  topicsCovered: { topic: string; detail: string }[];
  keyTakeaways: string[];
  notableDetails: string[];
  audience: string;
  verdict: string;
}

interface SummaryResult {
  structured: StructuredSummary;
  transcriptUsed: boolean;
  transcriptFailReason: string | null;
}

interface VideoPlayerModalProps {
  video: Video | null;
  onClose: () => void;
}

function SectionHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-3">
      <span className="text-primary">{icon}</span>
      <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">{label}</p>
    </div>
  );
}

function TopicItem({ topic, detail }: { topic: string; detail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
      >
        <span className="text-sm font-semibold text-text-main">{topic}</span>
        {open
          ? <ChevronUp className="w-4 h-4 text-text-muted shrink-0" />
          : <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="px-4 pb-4 text-sm text-text-muted leading-relaxed border-t border-border pt-3">
              {detail}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function VideoPlayerModal({ video, onClose }: VideoPlayerModalProps) {
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const { state: dlState, start: startDownload, reset: resetDownload, downloadUrl } = useVideoDownload();
  const prevVideoId = useRef<string | null>(null);

  // Reset download state when video changes
  useEffect(() => {
    if (video?.videoId !== prevVideoId.current) {
      prevVideoId.current = video?.videoId ?? null;
      resetDownload();
    }
  }, [video?.videoId, resetDownload]);

  const isOpen = video !== null;

  useEffect(() => {
    setResult(null);
    setSummaryError(null);
    setDescExpanded(false);
  }, [video?.videoId]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const generateSummary = useCallback(async () => {
    if (!video) return;
    setIsSummaryLoading(true);
    setSummaryError(null);
    try {
      const resp = await fetch("/api/videos/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: video.videoId,
          title: video.title,
          description: video.description,
          channelName: video.channelName,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate summary");
      }
      const data = await resp.json();
      if (data.structured) {
        setResult({
          structured: data.structured,
          transcriptUsed: data.transcriptUsed ?? false,
          transcriptFailReason: data.transcriptFailReason ?? null,
        });
      } else {
        setResult({
          transcriptUsed: false,
          transcriptFailReason: null,
          structured: {
            tldr: "", overview: data.summary ?? "", topicsCovered: [],
            keyTakeaways: [], notableDetails: [], audience: "", verdict: "",
          },
        });
      }
    } catch (err: any) {
      setSummaryError(err.message || "Something went wrong");
    } finally {
      setIsSummaryLoading(false);
    }
  }, [video]);

  if (!video) return null;

  const publishedDate = new Date(video.publishedAt);
  const relativeDate = isNaN(publishedDate.getTime())
    ? video.publishedAt
    : formatDistanceToNow(publishedDate, { addSuffix: true });
  const duration = formatDuration(video.duration);
  const shortDesc = video.description?.slice(0, 280);
  const hasMoreDesc = (video.description?.length ?? 0) > 280;
  const s = result?.structured;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/90 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 12 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className="relative z-10 w-full max-w-6xl max-h-[92vh] flex flex-col lg:flex-row bg-surface border border-border rounded-2xl overflow-hidden shadow-[0_32px_80px_-16px_rgba(0,0,0,0.7)]"
          >
            {/* Close */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 z-20 p-1.5 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/80 transition-colors backdrop-blur-sm"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Left — Player + meta */}
            <div className="flex flex-col w-full lg:w-[52%] shrink-0 overflow-y-auto lg:border-r border-border">
              <div className="relative w-full aspect-video bg-black shrink-0">
                <iframe
                  src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1&rel=0`}
                  title={video.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full"
                />
              </div>

              <div className="p-4 flex flex-col gap-3">
                <h2 className="text-text-main font-bold text-base leading-snug">{video.title}</h2>

                <div className="flex items-center gap-3">
                  {video.channelThumbnailUrl ? (
                    <img
                      src={video.channelThumbnailUrl}
                      alt={video.channelName}
                      className="w-8 h-8 rounded-full object-cover border border-border shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center text-xs font-bold text-text-muted border border-border shrink-0">
                      {video.channelName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-main truncate">{video.channelName}</p>
                    <div className="flex items-center gap-1.5 text-xs text-text-muted">
                      {video.viewCount && <span>{formatViews(video.viewCount)} views</span>}
                      {video.viewCount && <span>·</span>}
                      <span>{relativeDate}</span>
                      {duration && <><span>·</span><span>{duration}</span></>}
                    </div>
                  </div>
                </div>

                {video.description && (
                  <div className="text-xs text-text-muted leading-relaxed bg-background rounded-xl p-3">
                    <p className="whitespace-pre-line">
                      {descExpanded ? video.description : shortDesc}
                      {!descExpanded && hasMoreDesc && "..."}
                    </p>
                    {hasMoreDesc && (
                      <button
                        onClick={() => setDescExpanded((p) => !p)}
                        className="mt-1.5 flex items-center gap-1 text-primary hover:text-primary/80 transition-colors font-medium text-xs"
                      >
                        {descExpanded
                          ? <><ChevronUp className="w-3 h-3" /> Show less</>
                          : <><ChevronDown className="w-3 h-3" /> Show more</>}
                      </button>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3 flex-wrap">
                  <a
                    href={`https://youtube.com/watch?v=${video.videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open on YouTube
                  </a>

                  {/* 1080p video download */}
                  {dlState.status === "idle" && (
                    <button
                      onClick={() => startDownload(video.videoId, video.title)}
                      className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download 1080p
                    </button>
                  )}

                  {dlState.status === "running" && (
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-amber-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {dlState.message}
                      </div>
                      <div className="w-24 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full transition-all duration-500"
                          style={{ width: `${dlState.pct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {dlState.status === "done" && downloadUrl && (
                    <a
                      href={downloadUrl}
                      download={dlState.filename ?? `${video.title}.mp4`}
                      className="inline-flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300 font-semibold transition-colors"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Save MP4
                    </a>
                  )}

                  {dlState.status === "error" && (
                    <button
                      onClick={() => startDownload(video.videoId, video.title)}
                      className="inline-flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
                      title={dlState.error}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      Retry download
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right — AI Analysis */}
            <div className="flex flex-col w-full lg:w-[48%] overflow-y-auto">
              {/* Header */}
              <div className="sticky top-0 z-10 bg-surface border-b border-border px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-primary" />
                  </div>
                  <h3 className="font-bold text-text-main text-sm">AI Analysis</h3>
                </div>
                {result && (
                  <div
                    title={result.transcriptUsed ? "Summary generated from the real video transcript" : `Transcript unavailable — used video description instead.\n\nReason: ${result.transcriptFailReason ?? "unknown"}`}
                    className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border cursor-help ${result.transcriptUsed ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"}`}
                  >
                    <FileSearch className="w-2.5 h-2.5" />
                    {result.transcriptUsed ? "From transcript" : "From description"}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-5 p-5">
                {/* Not yet generated */}
                {!result && !isSummaryLoading && !summaryError && (
                  <div className="flex flex-col items-center justify-center text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center mb-5">
                      <Sparkles className="w-7 h-7 text-primary/40" />
                    </div>
                    <p className="text-text-muted text-sm mb-2 font-medium">Deep-dive AI analysis</p>
                    <p className="text-text-muted/70 text-xs mb-6 max-w-xs leading-relaxed">
                      Fetches the real transcript to give you a thorough breakdown — topics, takeaways, highlights, and a verdict.
                    </p>
                    <button
                      onClick={generateSummary}
                      className="px-6 py-3 bg-primary hover:bg-primary/90 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      Analyse Video
                    </button>
                  </div>
                )}

                {/* Loading */}
                {isSummaryLoading && (
                  <div className="flex flex-col items-center justify-center gap-4 py-12">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <div className="text-center">
                      <p className="text-text-main text-sm font-medium">Fetching transcript...</p>
                      <p className="text-text-muted text-xs mt-1">Analysing with AI — this takes a few seconds</p>
                    </div>
                  </div>
                )}

                {/* Error */}
                {summaryError && !isSummaryLoading && (
                  <div className="flex flex-col items-center text-center py-8">
                    <AlertCircle className="w-7 h-7 text-red-400 mb-3" />
                    <p className="text-red-400 text-sm mb-4">{summaryError}</p>
                    <button
                      onClick={generateSummary}
                      className="px-4 py-2 bg-surface-hover hover:bg-border rounded-xl text-sm font-medium transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                )}

                {/* Results */}
                {s && !isSummaryLoading && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-5"
                  >
                    {/* TL;DR */}
                    {s.tldr && (
                      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                        <SectionHeading icon={<Zap className="w-3.5 h-3.5" />} label="TL;DR" />
                        <p className="text-text-main text-sm font-semibold leading-relaxed">{s.tldr}</p>
                      </div>
                    )}

                    {/* Overview */}
                    {s.overview && (
                      <div className="bg-background rounded-xl p-4 border border-border">
                        <SectionHeading icon={<BookOpen className="w-3.5 h-3.5" />} label="Overview" />
                        <p className="text-text-main text-sm leading-relaxed">{s.overview}</p>
                      </div>
                    )}

                    {/* Topics Covered */}
                    {s.topicsCovered.length > 0 && (
                      <div>
                        <SectionHeading icon={<FileText className="w-3.5 h-3.5" />} label="Topics Covered" />
                        <div className="flex flex-col gap-2">
                          {s.topicsCovered.map((t, i) => (
                            <TopicItem key={i} topic={t.topic} detail={t.detail} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key Takeaways */}
                    {s.keyTakeaways.length > 0 && (
                      <div className="bg-background rounded-xl p-4 border border-border">
                        <SectionHeading icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Key Takeaways" />
                        <ul className="flex flex-col gap-2.5">
                          {s.keyTakeaways.map((pt, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-sm text-text-main">
                              <span className="mt-0.5 w-4 h-4 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                                {i + 1}
                              </span>
                              <span className="leading-relaxed">{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Notable Details */}
                    {s.notableDetails.length > 0 && (
                      <div className="bg-background rounded-xl p-4 border border-border">
                        <SectionHeading icon={<Lightbulb className="w-3.5 h-3.5" />} label="Notable Details" />
                        <ul className="flex flex-col gap-2">
                          {s.notableDetails.map((d, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-text-muted">
                              <span className="text-primary mt-0.5 shrink-0">›</span>
                              <span className="leading-relaxed">{d}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Best for */}
                    {s.audience && (
                      <div className="bg-background rounded-xl p-4 border border-border">
                        <SectionHeading icon={<Users className="w-3.5 h-3.5" />} label="Best For" />
                        <p className="text-text-main text-sm leading-relaxed">{s.audience}</p>
                      </div>
                    )}

                    {/* Verdict */}
                    {s.verdict && (
                      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                        <SectionHeading icon={<Star className="w-3.5 h-3.5" />} label="Verdict" />
                        <p className="text-text-main text-sm leading-relaxed">{s.verdict}</p>
                      </div>
                    )}

                    {/* Regenerate */}
                    <button
                      onClick={generateSummary}
                      className="self-start flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors pb-2"
                    >
                      <Sparkles className="w-3 h-3" />
                      Regenerate analysis
                    </button>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
