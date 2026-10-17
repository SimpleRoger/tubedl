import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Mic, MicOff, AlertCircle, Loader2, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { VideoCard } from "../components/video-card";
import { VideoSkeleton } from "../components/video-skeleton";
import { PitchMeter } from "../components/pitch-meter";
import { PianoKeyboard } from "../components/piano-keyboard";
import { Header } from "../components/header";
import { usePitchDetection } from "../hooks/use-pitch-detection";
import { midiToFrequency, midiToNoteName } from "../lib/pitch-detection";
import { playTone, stopTone } from "../lib/tone-synth";
import { customFetch, useSavedVideos } from "@workspace/api-client-react";
import type { Video } from "@workspace/api-client-react";

// C2 to B5 — four octaves, comfortably covers most singing voices
const KEYBOARD_LOW_MIDI = 36;
const KEYBOARD_HIGH_MIDI = 83;

export default function SingAlong() {
  const [query, setQuery] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [results, setResults] = useState<Video[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<Video | null>(null);
  const [targetMidi, setTargetMidi] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { savedIds, toggleSave } = useSavedVideos();
  const { start, stop, pitch, isListening, error: micError } = usePitchDetection();

  const handleKeyPress = useCallback((midi: number) => {
    setTargetMidi(midi);
    playTone(midiToFrequency(midi));
  }, []);

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

  useEffect(() => {
    if (!nowPlaying) inputRef.current?.focus();
  }, [nowPlaying]);

  // Stop the mic and any reference tone whenever the video changes or this page is left
  useEffect(() => () => { stop(); stopTone(); }, [nowPlaying, stop]);

  const skeletons = Array.from({ length: 8 });

  if (nowPlaying) {
    return (
      <div className="min-h-screen bg-background flex flex-col font-sans">
        <Header />
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
          <button
            onClick={() => setNowPlaying(null)}
            className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors self-start"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to search
          </button>

          <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-2xl">
            <iframe
              src={`https://www.youtube.com/embed/${nowPlaying.videoId}?autoplay=1&rel=0`}
              title={nowPlaying.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>

          <h1 className="text-text-main font-bold text-base leading-snug -mt-2">{nowPlaying.title}</h1>

          <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col items-center gap-5">
            {micError && (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {micError}
              </div>
            )}

            <PitchMeter pitch={isListening ? pitch : null} />

            <button
              onClick={isListening ? stop : start}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.98] ${
                isListening
                  ? "bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
                  : "bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/20"
              }`}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {isListening ? "Stop Singing" : "Start Singing"}
            </button>

            <p className="text-xs text-text-muted text-center max-w-sm">
              Sing along with the video — your live note and how sharp/flat you are shows up above.
              Headphones help a lot here, since your mic will otherwise pick up the video's own audio too.
            </p>
          </div>

          <div className="bg-surface border border-border rounded-2xl p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">
                Pitch Match
              </p>
              {targetMidi !== null && (() => {
                const { note, octave } = midiToNoteName(targetMidi);
                const matched = isListening && pitch?.midi === targetMidi;
                return (
                  <span className={`text-sm font-bold ${matched ? "text-green-400" : "text-text-main"}`}>
                    Target: {note}{octave} {matched && "— Match! 🎯"}
                  </span>
                );
              })()}
            </div>
            <PianoKeyboard
              lowMidi={KEYBOARD_LOW_MIDI}
              highMidi={KEYBOARD_HIGH_MIDI}
              targetMidi={targetMidi}
              liveMidi={isListening ? pitch?.midi ?? null : null}
              onKeyPress={handleKeyPress}
            />
            <p className="text-xs text-text-muted text-center">
              Click a key to hear it, then try to match it with your voice.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <Header>
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Find a video to sing along to…"
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

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-8">
        {!hasSearched && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center justify-center py-24 text-center"
          >
            <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6 shadow-2xl">
              <Mic className="w-9 h-9 text-primary" />
            </div>
            <h1 className="text-4xl font-display font-bold text-text-main mb-3 tracking-tight">
              Sing Along
            </h1>
            <p className="text-text-muted max-w-md text-lg leading-relaxed">
              Pick a video, then sing along — see the exact note you're hitting live, and whether you're sharp or flat.
            </p>
          </motion.div>
        )}

        {searchError && !isSearching && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-6">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-sm text-red-400">{searchError}</p>
          </div>
        )}

        {isSearching && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {skeletons.map((_, i) => (
              <VideoSkeleton key={i} />
            ))}
          </div>
        )}

        {!isSearching && hasSearched && results.length === 0 && !searchError && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Search className="w-10 h-10 text-border-hover mb-4" />
            <p className="text-lg font-semibold text-text-main mb-2">No results for "{query}"</p>
            <p className="text-text-muted text-sm">Try a different search term.</p>
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
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
                    onClick={setNowPlaying}
                    isSaved={savedIds.has(video.videoId)}
                    onToggleSave={toggleSave}
                  />
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
