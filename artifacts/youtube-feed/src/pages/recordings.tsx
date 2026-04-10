import { useState } from "react";
import { Link } from "wouter";
import { Tv2, Music2, FileText, Mic, Trash2, Download, Play, Loader2, Cloud, Bookmark } from "lucide-react";
import { motion } from "framer-motion";
import { useRecordings, useDeleteRecording } from "../hooks/use-recordings";
import type { RecordingItem } from "@workspace/api-client-react";

function formatSeconds(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RecordingCard({ rec }: { rec: RecordingItem }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const deleteRecording = useDeleteRecording();
  const servingUrl = `/api/storage${rec.objectPath}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-3"
    >
      {/* Beat info */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-border">
          <img src={rec.beatThumbnailUrl} alt={rec.beatTitle} className="w-full h-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-text-main text-sm font-semibold truncate">{rec.beatTitle}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Music2 className="w-3 h-3 text-primary shrink-0" />
            <p className="text-xs text-text-muted truncate">{rec.beatChannelName}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-text-muted">{formatDate(rec.createdAt)}</p>
          <p className="text-xs text-text-muted mt-0.5 font-mono">{formatSeconds(rec.durationSeconds)}</p>
        </div>
      </div>

      {/* Playback */}
      <div
        className={`rounded-xl p-3 border transition-colors ${
          isPlaying ? "bg-red-500/5 border-red-500/20" : "bg-background border-border"
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${isPlaying ? "text-red-400" : "text-text-muted"}`}>
            {isPlaying ? "▶ Playing" : "Freestyle recording"}
          </span>
        </div>
        <audio
          src={servingUrl}
          controls
          className="w-full h-8"
          style={{ accentColor: "#ef4444" }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <a
          href={servingUrl}
          download={`${rec.beatTitle} - freestyle`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-text-muted hover:text-text-main border border-border hover:border-primary/30 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </a>
        <a
          href={`https://youtube.com/watch?v=${rec.beatVideoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-text-muted hover:text-primary border border-border hover:border-primary/30 transition-all"
        >
          <Play className="w-3.5 h-3.5" />
          Open beat
        </a>
        <button
          onClick={() => deleteRecording.mutate(rec.id)}
          disabled={deleteRecording.isPending}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-text-muted hover:text-red-400 border border-border hover:border-red-500/20 transition-all disabled:opacity-50"
        >
          {deleteRecording.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
          Delete
        </button>
      </div>
    </motion.div>
  );
}

export default function Recordings() {
  const { data: recordings, isLoading } = useRecordings();

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="h-16 border-b border-border glass-panel sticky top-0 z-40 flex items-center px-4 sm:px-6">
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
            <Link href="/lyrics">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer">
                <FileText className="w-3.5 h-3.5" />Lyrics
              </span>
            </Link>
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-semibold bg-primary/15 text-primary border border-primary/20">
              <Mic className="w-3.5 h-3.5" />Recordings
            </span>
            <Link href="/saved">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium text-text-muted hover:text-text-main hover:bg-surface-hover transition-colors cursor-pointer">
                <Bookmark className="w-3.5 h-3.5" />Saved
              </span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-text-main flex items-center gap-2">
              <Cloud className="w-6 h-6 text-blue-400" />
              Cloud Recordings
            </h2>
            <p className="text-text-muted text-sm mt-1">
              Your freestyle recordings, saved in the cloud
            </p>
          </div>
          {recordings && recordings.length > 0 && (
            <span className="text-xs text-text-muted bg-surface border border-border px-2.5 py-1 rounded-full">
              {recordings.length} recording{recordings.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-3 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading recordings…</span>
          </div>
        )}

        {!isLoading && (!recordings || recordings.length === 0) && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-surface border border-border flex items-center justify-center mb-6">
              <Mic className="w-9 h-9 text-text-muted/40" />
            </div>
            <h3 className="text-xl font-bold text-text-main mb-2">No recordings yet</h3>
            <p className="text-text-muted max-w-sm text-sm leading-relaxed mb-6">
              Open any beat, hit Record, freestyle over it, then tap "Save to cloud" to store it here.
            </p>
            <Link href="/beats">
              <span className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-primary/20 cursor-pointer">
                <Music2 className="w-4 h-4" />
                Go to Beats
              </span>
            </Link>
          </div>
        )}

        {!isLoading && recordings && recordings.length > 0 && (
          <div className="flex flex-col gap-4">
            {recordings.map((rec) => (
              <RecordingCard key={rec.id} rec={rec} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
