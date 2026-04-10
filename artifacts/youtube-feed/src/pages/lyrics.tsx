import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Tv2, Music2, FileText, ChevronDown, ChevronUp, ExternalLink, Trash2, PenLine, Play, Mic, Bookmark } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { BeatPlayer } from "../components/beat-player";
import type { Video } from "@workspace/api-client-react";

interface BeatMeta {
  videoId: string;
  title: string;
  channelName: string;
  thumbnailUrl?: string | null;
}

interface LyricEntry {
  meta: BeatMeta;
  lyrics: string;
  updatedAt: number;
}

function loadAllLyrics(): LyricEntry[] {
  const entries: LyricEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("tubefeed-lyrics-")) continue;
    const videoId = key.replace("tubefeed-lyrics-", "");
    const lyrics = localStorage.getItem(key);
    if (!lyrics?.trim()) continue;

    const rawMeta = localStorage.getItem(`tubefeed-beat-meta-${videoId}`);
    let meta: BeatMeta = { videoId, title: videoId, channelName: "" };
    if (rawMeta) {
      try { meta = { ...meta, ...JSON.parse(rawMeta) }; } catch { /* ignore */ }
    }

    const rawTime = localStorage.getItem(`tubefeed-beat-time-${videoId}`);
    const updatedAt = rawTime ? parseInt(rawTime, 10) : 0;

    entries.push({ meta, lyrics, updatedAt });
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

function metaToVideo(meta: BeatMeta): Video {
  return {
    videoId: meta.videoId,
    title: meta.title,
    description: "",
    thumbnailUrl: meta.thumbnailUrl ?? `https://img.youtube.com/vi/${meta.videoId}/mqdefault.jpg`,
    publishedAt: new Date(0).toISOString(),
    viewCount: null,
    channelId: "",
    channelName: meta.channelName,
    channelThumbnailUrl: null,
    duration: null,
  };
}

export default function Lyrics() {
  const [entries, setEntries] = useState<LyricEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLyrics, setDraftLyrics] = useState("");
  const [activeBeat, setActiveBeat] = useState<Video | null>(null);

  useEffect(() => {
    setEntries(loadAllLyrics());
  }, []);

  const handlePlay = useCallback((meta: BeatMeta) => {
    setActiveBeat(metaToVideo(meta));
  }, []);

  const handleDelete = (videoId: string) => {
    localStorage.removeItem(`tubefeed-lyrics-${videoId}`);
    localStorage.removeItem(`tubefeed-beat-meta-${videoId}`);
    localStorage.removeItem(`tubefeed-beat-time-${videoId}`);
    setEntries((prev) => prev.filter((e) => e.meta.videoId !== videoId));
    if (expandedId === videoId) setExpandedId(null);
  };

  const startEdit = (entry: LyricEntry) => {
    setEditingId(entry.meta.videoId);
    setDraftLyrics(entry.lyrics);
    setExpandedId(entry.meta.videoId);
  };

  const saveEdit = (videoId: string) => {
    localStorage.setItem(`tubefeed-lyrics-${videoId}`, draftLyrics);
    localStorage.setItem(`tubefeed-beat-time-${videoId}`, Date.now().toString());
    setEntries((prev) =>
      prev.map((e) => e.meta.videoId === videoId ? { ...e, lyrics: draftLyrics, updatedAt: Date.now() } : e)
    );
    setEditingId(null);
  };

  const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
  const lineCount = (text: string) => text.split("\n").length;

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
            <Link href="/beats">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer">
                <Music2 className="w-3.5 h-3.5" />Beats
              </span>
            </Link>
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-semibold bg-primary/15 text-primary border border-primary/20">
              <FileText className="w-3.5 h-3.5" />Lyrics
            </span>
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

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-display font-bold text-text-main">My Lyrics</h2>
          <p className="text-text-muted mt-1 text-sm">
            {entries.length > 0
              ? `${entries.length} song${entries.length !== 1 ? "s" : ""} written across your beats`
              : "Your lyrics will appear here once you start writing"}
          </p>
        </div>

        {/* Empty state */}
        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-full bg-surface border border-border flex items-center justify-center mb-6">
              <FileText className="w-9 h-9 text-text-muted/40" />
            </div>
            <h3 className="text-xl font-bold text-text-main mb-2">Nothing written yet</h3>
            <p className="text-text-muted max-w-sm mb-6 text-sm leading-relaxed">
              Head to the Beats tab, click any beat to open the player, and start writing your lyrics in the notepad.
            </p>
            <Link href="/beats">
              <span className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-primary/20 cursor-pointer">
                <Music2 className="w-4 h-4" />
                Go to Beats
              </span>
            </Link>
          </div>
        )}

        {/* Lyrics list */}
        <div className="flex flex-col gap-4">
          {entries.map((entry, index) => {
            const isExpanded = expandedId === entry.meta.videoId;
            const isEditing = editingId === entry.meta.videoId;
            const words = wordCount(entry.lyrics);
            const lines = lineCount(entry.lyrics);
            const preview = entry.lyrics.split("\n").slice(0, 3).join("\n");

            return (
              <motion.div
                key={entry.meta.videoId}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(index * 0.06, 0.5) }}
                className="bg-surface border border-border rounded-2xl overflow-hidden"
              >
                {/* Card header */}
                <div className="flex items-center gap-3 p-4">
                  {/* Clickable thumbnail */}
                  <button
                    onClick={() => handlePlay(entry.meta)}
                    className="group relative shrink-0 w-14 h-10 rounded-lg overflow-hidden border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    title="Play beat"
                  >
                    {entry.meta.thumbnailUrl ? (
                      <img
                        src={entry.meta.thumbnailUrl}
                        alt={entry.meta.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-surface-hover flex items-center justify-center">
                        <Music2 className="w-5 h-5 text-text-muted/50" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-4 h-4 text-white" fill="currentColor" />
                    </div>
                  </button>
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => handlePlay(entry.meta)}
                      className="text-sm font-semibold text-text-main hover:text-primary transition-colors line-clamp-1 text-left"
                    >
                      {entry.meta.title}
                    </button>
                    <p className="text-xs text-text-muted truncate">{entry.meta.channelName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-text-muted bg-background px-1.5 py-0.5 rounded-full border border-border">
                        {words} words
                      </span>
                      <span className="text-[10px] text-text-muted bg-background px-1.5 py-0.5 rounded-full border border-border">
                        {lines} lines
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={`https://youtube.com/watch?v=${entry.meta.videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-surface-hover transition-colors"
                      title="Open beat on YouTube"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button
                      onClick={() => startEdit(entry)}
                      className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-surface-hover transition-colors"
                      title="Edit lyrics"
                    >
                      <PenLine className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(entry.meta.videoId)}
                      className="p-2 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Delete lyrics"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : entry.meta.videoId)}
                      className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors ml-1"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Preview (collapsed) */}
                {!isExpanded && (
                  <div
                    className="px-4 pb-4 cursor-pointer"
                    onClick={() => setExpandedId(entry.meta.videoId)}
                  >
                    <pre className="text-text-muted text-xs font-mono leading-relaxed whitespace-pre-wrap line-clamp-3 bg-background rounded-xl px-3 py-2 border border-border">
                      {preview}
                      {entry.lyrics.split("\n").length > 3 && "\n…"}
                    </pre>
                  </div>
                )}

                {/* Expanded lyrics */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4">
                        {isEditing ? (
                          <>
                            <textarea
                              value={draftLyrics}
                              onChange={(e) => setDraftLyrics(e.target.value)}
                              className="w-full min-h-[280px] bg-background border border-primary/40 rounded-xl p-4 text-text-main text-sm font-mono leading-relaxed resize-y focus:outline-none focus:border-primary/70 transition-colors"
                              spellCheck={false}
                              autoFocus
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => saveEdit(entry.meta.videoId)}
                                className="px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-semibold rounded-xl transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => { setEditingId(null); setDraftLyrics(""); }}
                                className="px-4 py-2 bg-surface-hover hover:bg-border text-text-muted text-sm rounded-xl transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        ) : (
                          <pre className="text-text-main text-sm font-mono leading-relaxed whitespace-pre-wrap bg-background rounded-xl px-4 py-3 border border-border max-h-[420px] overflow-y-auto">
                            {entry.lyrics}
                          </pre>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </main>

      <BeatPlayer
        beat={activeBeat}
        onClose={() => setActiveBeat(null)}
        onBeatSelect={(beat) => setActiveBeat(beat)}
      />
    </div>
  );
}
