import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import {
  Play, Square, Circle, Volume2, ArrowLeft,
  Loader2, Pause, SkipBack, Mic, ZoomIn, ZoomOut,
} from "lucide-react";
import type { Video } from "@workspace/api-client-react";

const BEAT_KEY = "tubefeed-daw-beat";
const LANE_COLORS = ["#ef4444", "#22c55e", "#8b5cf6"];
const LANE_NAMES  = ["Vocal 1", "Vocal 2", "Vocal 3"];
const TIMELINE_SECS = 300; // total canvas length (5 min)

// ── YouTube IFrame API bootstrap ──────────────────────────────────────────────
let _ytLoaded = false;
let _ytReady  = false;
const _ytCbs: (() => void)[] = [];
function loadYT(cb: () => void) {
  if (_ytReady) { cb(); return; }
  _ytCbs.push(cb);
  if (_ytLoaded) return;
  _ytLoaded = true;
  (window as any).onYouTubeIframeAPIReady = () => {
    _ytReady = true;
    _ytCbs.forEach((f) => f());
    _ytCbs.length = 0;
  };
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
}

function fmtTime(sec: number) {
  const m   = Math.floor(sec / 60);
  const s   = Math.floor(sec % 60);
  const dec = Math.floor((sec % 1) * 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${dec}`;
}

function fmtRuler(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

/** Pick a ruler tick interval (seconds) so ticks are ~60-100px apart */
function rulerInterval(zoom: number) {
  const nice = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const target = 70 / zoom;
  return nice.find((v) => v >= target) ?? 300;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Lane = {
  id: number; name: string; color: string;
  muted: boolean; volume: number;
  blobUrl: string | null; mime: string;
  waveform: number[]; durationSec: number;
};
function makeLanes(): Lane[] {
  return LANE_NAMES.map((name, i) => ({
    id: i, name, color: LANE_COLORS[i],
    muted: false, volume: 80,
    blobUrl: null, mime: "audio/webm",
    waveform: [], durationSec: 0,
  }));
}

// ── Waveform canvas ───────────────────────────────────────────────────────────
function WaveCanvas({ data, color, zoom, durationSec }: {
  data: number[]; color: string; zoom: number; durationSec: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = Math.max(durationSec * zoom, 80);
  useEffect(() => {
    const c = ref.current;
    if (!c || data.length === 0) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const W = c.width, H = c.height, mid = H / 2;
    ctx.clearRect(0, 0, W, H);
    const bw = W / data.length;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    data.forEach((v, i) => {
      const h = Math.max(2, v * mid * 1.8);
      ctx.fillRect(i * bw, mid - h / 2, Math.max(1, bw - 0.5), h);
    });
  }, [data, color, width]);
  return (
    <canvas
      ref={ref}
      width={Math.round(width)}
      height={56}
      className="h-full"
      style={{ width }}
    />
  );
}

// Static decorative beat bars
const BEAT_BARS = Array.from({ length: 200 }, (_, i) =>
  30 + Math.abs(Math.sin(i * 0.37) * 52 + Math.sin(i * 0.13 + 1) * 28)
);

// ── Main DAW page ─────────────────────────────────────────────────────────────
export default function DawPage() {
  const [beat, setBeat]               = useState<Video | null>(null);
  const [lanes, setLanes]             = useState<Lane[]>(makeLanes);
  const [armedLane, setArmedLane]     = useState(-1);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [time, setTime]               = useState(0);
  const [ytReady, setYtReady]         = useState(false);
  const [micError, setMicError]       = useState(false);
  const [zoom, setZoom]               = useState(50); // px per second

  const ytRef      = useRef<any>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseRef    = useRef(0);
  const timeRef    = useRef(0);
  const mrRef      = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const recLaneRef = useRef(-1);
  const audioEls   = useRef<(HTMLAudioElement | null)[]>([null, null, null]);
  const tlRef      = useRef<HTMLDivElement>(null); // scrollable timeline

  // ── Load beat ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BEAT_KEY);
      if (raw) { sessionStorage.removeItem(BEAT_KEY); setBeat(JSON.parse(raw)); }
    } catch { /* ignore */ }
  }, []);

  // ── Boot YouTube player ──
  useEffect(() => {
    if (!beat) return;
    loadYT(() => {
      if (ytRef.current) return;
      ytRef.current = new (window as any).YT.Player("daw-yt-player", {
        videoId: beat.videoId,
        playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0 },
        events: { onReady: () => setYtReady(true) },
      });
    });
    return () => {
      try { ytRef.current?.destroy?.(); } catch (_) {}
      ytRef.current = null; setYtReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat?.videoId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      try { ytRef.current?.destroy?.(); } catch (_) {}
    };
  }, []);

  // ── Auto-scroll playhead into view ──
  useEffect(() => {
    const el = tlRef.current;
    if (!el || !isPlaying) return;
    const px = timeRef.current * zoom;
    const { scrollLeft, clientWidth } = el;
    if (px > scrollLeft + clientWidth - 60) {
      el.scrollLeft = px - clientWidth / 3;
    }
  }, [time, zoom, isPlaying]);

  // ── Helpers ──
  function stopClock() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }
  function startClock(fromSec = 0) {
    stopClock();
    baseRef.current = Date.now() - fromSec * 1000;
    timerRef.current = setInterval(() => {
      const t = (Date.now() - baseRef.current) / 1000;
      setTime(t); timeRef.current = t;
    }, 16);
  }
  function stopAll() {
    stopClock();
    try { ytRef.current?.stopVideo?.(); } catch (_) {}
    audioEls.current.forEach((a) => { if (a) { a.pause(); a.currentTime = 0; } });
    if (mrRef.current?.state === "recording") mrRef.current.stop();
    setIsPlaying(false); setIsRecording(false);
    setTime(0); timeRef.current = 0;
  }

  async function decodeWaveform(blob: Blob, laneId: number) {
    try {
      const ac  = new AudioContext();
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      const raw = buf.getChannelData(0);
      const N   = 300;
      const blk = Math.floor(raw.length / N);
      const wf: number[] = [];
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let j = 0; j < blk; j++) s += Math.abs(raw[i * blk + j] || 0);
        wf.push(Math.min(1, (s / blk) * 6));
      }
      await ac.close();
      setLanes((p) => p.map((l) => l.id === laneId
        ? { ...l, waveform: wf, durationSec: buf.duration }
        : l
      ));
    } catch { /* ignore */ }
  }

  // ── Seek ──
  const seekTo = useCallback((sec: number) => {
    const t = Math.max(0, Math.min(sec, TIMELINE_SECS));
    setTime(t); timeRef.current = t;
    if (isPlaying) {
      try { ytRef.current?.seekTo?.(t, true); } catch (_) {}
      audioEls.current.forEach((a, i) => {
        if (a && lanes[i]?.blobUrl && !lanes[i]?.muted) {
          a.currentTime = Math.min(t, a.duration || 0);
        }
      });
      // Update clock base
      baseRef.current = Date.now() - t * 1000;
    }
  }, [isPlaying, lanes]);

  // ── Timeline click to seek ──
  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if (isRecording) return;
    const el = tlRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    seekTo(x / zoom);
  }

  // ── Transport ──
  async function handleRecord() {
    if (armedLane < 0 || !ytReady) return;
    stopAll();
    setMicError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      mrRef.current = mr; chunksRef.current = []; recLaneRef.current = armedLane;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        const url  = URL.createObjectURL(blob);
        const lid  = recLaneRef.current;
        setLanes((p) => p.map((l) => l.id === lid ? { ...l, blobUrl: url, mime } : l));
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        decodeWaveform(blob, lid);
      };
      mr.start(100);
      ytRef.current.seekTo(0, true); ytRef.current.playVideo();
      startClock(0);
      setIsRecording(true); setIsPlaying(true);
    } catch { setMicError(true); }
  }

  function handlePlay() {
    if (isPlaying) return;
    const t = timeRef.current;
    try { ytRef.current?.seekTo?.(t, true); ytRef.current?.playVideo?.(); } catch (_) {}
    lanes.forEach((lane, i) => {
      const a = audioEls.current[i];
      if (a && lane.blobUrl && !lane.muted) {
        a.volume = lane.volume / 100;
        a.currentTime = Math.min(t, a.duration || 0);
        a.play().catch(() => {});
      }
    });
    startClock(t);
    setIsPlaying(true);
  }

  function handlePause() {
    stopClock();
    try { ytRef.current?.pauseVideo?.(); } catch (_) {}
    audioEls.current.forEach((a) => { if (a) a.pause(); });
    setIsPlaying(false);
  }

  // ── Zoom ──
  const changeZoom = (delta: number) => {
    setZoom((z) => Math.max(8, Math.min(400, z * delta)));
  };

  // ── Ruler ticks ──
  const interval  = rulerInterval(zoom);
  const tickCount = Math.ceil(TIMELINE_SECS / interval) + 1;
  const ticks     = Array.from({ length: tickCount }, (_, i) => i * interval);
  const totalWidth = TIMELINE_SECS * zoom;
  const TRACK_H   = 76;
  const RULER_H   = 24;
  const LEFT_W    = 208; // px, matches w-52

  if (!beat) {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex flex-col items-center justify-center gap-4 text-white">
        <Mic className="w-12 h-12 text-gray-600" />
        <p className="text-gray-400 text-sm">No beat loaded.</p>
        <p className="text-gray-600 text-xs">Go to Beats, open a beat, then click "Open DAW".</p>
        <Link href="/beats">
          <span className="mt-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-sm cursor-pointer transition-colors">
            Back to Beats
          </span>
        </Link>
      </div>
    );
  }

  const playheadPx = time * zoom;

  return (
    <div className="h-screen bg-[#0e0e0e] flex flex-col font-sans text-white select-none overflow-hidden">

      {/* ── Transport bar ── */}
      <div className="h-14 bg-[#1c1c1c] border-b border-[#333] flex items-center px-4 gap-3 shrink-0">
        <Link href="/beats">
          <span className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors cursor-pointer">
            <ArrowLeft className="w-3.5 h-3.5" />Beats
          </span>
        </Link>
        <div className="w-px h-5 bg-[#333]" />

        {/* Transport controls */}
        <div className="flex items-center gap-1">
          <button onClick={stopAll} title="Stop / Rewind" className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <SkipBack className="w-4 h-4 text-gray-400" />
          </button>
          {isPlaying ? (
            <button onClick={handlePause} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
              <Pause className="w-4 h-4 text-white" />
            </button>
          ) : (
            <button onClick={handlePlay} disabled={!ytReady} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-40">
              <Play className="w-4 h-4 text-white" />
            </button>
          )}
          <button onClick={stopAll} className="p-2 rounded-lg hover:bg-white/10 transition-colors" title="Stop">
            <Square className="w-4 h-4 text-gray-400" />
          </button>
          <button
            onClick={handleRecord}
            disabled={armedLane < 0 || !ytReady}
            title={armedLane < 0 ? "Arm a lane first" : "Record"}
            className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${
              isRecording ? "bg-red-600 shadow-lg shadow-red-900/50" : "bg-red-900/30 hover:bg-red-600/50"
            }`}
          >
            <Circle className="w-4 h-4 text-red-400" fill={isRecording ? "currentColor" : "none"} />
          </button>
        </div>

        {/* Time */}
        <div className="font-mono text-lg text-white tabular-nums bg-black/40 px-3 py-1 rounded-lg border border-[#2a2a2a] min-w-[90px] text-center">
          {fmtTime(time)}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1 ml-1">
          <button
            onClick={() => changeZoom(0.6)}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4 text-gray-400" />
          </button>
          <span className="text-[10px] text-gray-600 w-10 text-center tabular-nums">
            {zoom < 20 ? `${zoom.toFixed(0)}` : zoom < 100 ? `${zoom.toFixed(0)}` : `${zoom.toFixed(0)}`}px/s
          </span>
          <button
            onClick={() => changeZoom(1.667)}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Beat info */}
        <div className="flex items-center gap-2 ml-1 min-w-0 flex-1">
          <img src={beat.thumbnailUrl} className="w-8 h-8 rounded object-cover shrink-0 border border-[#333]" alt="" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white/90 truncate leading-tight">{beat.title}</p>
            <p className="text-[10px] text-gray-500 truncate">{beat.channelName}</p>
          </div>
        </div>

        {/* Status */}
        <div className="shrink-0 flex items-center gap-2 text-xs">
          {!ytReady && <span className="flex items-center gap-1 text-gray-500"><Loader2 className="w-3 h-3 animate-spin" />Loading…</span>}
          {micError && <span className="text-red-400">Mic access denied</span>}
          {isRecording && <span className="flex items-center gap-1.5 text-red-400 font-bold animate-pulse"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />REC</span>}
          {armedLane >= 0 && !isRecording && (
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-red-600/40 text-red-400/80">
              {LANE_NAMES[armedLane]} armed
            </span>
          )}
        </div>
      </div>

      {/* ── Main track area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: stacked track panels */}
        <div className="shrink-0 flex flex-col border-r border-[#2a2a2a] bg-[#161616]" style={{ width: LEFT_W }}>

          {/* Ruler spacer */}
          <div className="shrink-0 border-b border-[#2a2a2a] flex items-center px-3" style={{ height: RULER_H }}>
            <span className="text-[9px] text-gray-600 font-bold uppercase tracking-widest">Track</span>
          </div>

          {/* Beat panel */}
          <div className="shrink-0 flex items-center gap-3 px-3 bg-[#1a1a1a] border-b border-[#2a2a2a]" style={{ height: TRACK_H }}>
            <img src={beat.thumbnailUrl} className="w-9 h-9 rounded-lg object-cover shrink-0 border border-[#333]" alt="" />
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-gray-300 truncate">Beat</p>
              <p className="text-[10px] text-gray-600 truncate">{beat.channelName}</p>
            </div>
          </div>

          {/* Lane panels */}
          {lanes.map((lane) => (
            <div
              key={lane.id}
              className="shrink-0 flex items-center gap-2 px-3 bg-[#181818] border-b border-[#222] transition-colors"
              style={{ height: TRACK_H, backgroundColor: armedLane === lane.id ? `${lane.color}0a` : undefined }}
            >
              {/* Arm */}
              <button
                onClick={() => setArmedLane((p) => p === lane.id ? -1 : lane.id)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all shrink-0 border"
                style={armedLane === lane.id
                  ? { backgroundColor: "#dc2626", borderColor: "#ef4444" }
                  : { borderColor: "#2a2a2a", color: "#666" }
                }
                title="Arm for recording"
              >
                <Circle className="w-3 h-3" style={{ color: armedLane === lane.id ? "white" : "#666" }} fill={armedLane === lane.id ? "white" : "none"} />
              </button>

              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold truncate mb-1" style={{ color: lane.blobUrl ? lane.color : "#ccc" }}>
                  {lane.name}
                </p>
                <div className="flex items-center gap-1">
                  <Volume2 className="w-2.5 h-2.5 text-gray-700 shrink-0" />
                  <input
                    type="range" min={0} max={100} value={lane.volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLanes((p) => p.map((l) => l.id === lane.id ? { ...l, volume: v } : l));
                      const a = audioEls.current[lane.id];
                      if (a) a.volume = v / 100;
                    }}
                    className="flex-1 h-1 cursor-pointer min-w-0"
                    style={{ accentColor: lane.color }}
                  />
                  <span className="text-[9px] text-gray-600 w-6 text-right shrink-0">{lane.volume}</span>
                </div>
              </div>

              {/* Mute */}
              <button
                onClick={() => setLanes((p) => p.map((l) => l.id === lane.id ? { ...l, muted: !l.muted } : l))}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all shrink-0 border"
                style={lane.muted
                  ? { backgroundColor: "rgba(234,179,8,0.15)", borderColor: "rgba(234,179,8,0.4)", color: "#eab308" }
                  : { borderColor: "#2a2a2a", color: "#555" }
                }
                title={lane.muted ? "Unmute" : "Mute"}
              >M</button>
            </div>
          ))}
        </div>

        {/* Right: scrollable timeline */}
        <div
          ref={tlRef}
          className="flex-1 overflow-x-auto overflow-y-hidden relative"
          style={{ cursor: isRecording ? "not-allowed" : "crosshair" }}
        >
          <div style={{ width: totalWidth, position: "relative", minHeight: "100%" }}>

            {/* ── Ruler ── */}
            <div
              className="sticky top-0 z-20 bg-[#161616] border-b border-[#2a2a2a] overflow-hidden"
              style={{ height: RULER_H }}
              onClick={handleTimelineClick}
            >
              {ticks.map((sec) => {
                const x = sec * zoom;
                return (
                  <div key={sec} className="absolute top-0 flex flex-col items-start" style={{ left: x }}>
                    <div className="w-px bg-[#3a3a3a]" style={{ height: RULER_H }} />
                    <span className="text-[9px] text-gray-500 ml-1 absolute top-1" style={{ left: 2 }}>
                      {fmtRuler(sec)}
                    </span>
                  </div>
                );
              })}
              {/* Sub-ticks */}
              {interval >= 2 && ticks.flatMap((sec) =>
                Array.from({ length: 4 }, (_, j) => sec + interval * (j + 1) / 5).filter((s) => s < TIMELINE_SECS).map((s) => (
                  <div key={`sub-${s}`} className="absolute bottom-0 w-px bg-[#2a2a2a]" style={{ left: s * zoom, height: 6 }} />
                ))
              )}
            </div>

            {/* ── Click-to-seek overlay (spans all track rows) ── */}
            <div
              className="absolute z-10"
              style={{ top: RULER_H, left: 0, right: 0, bottom: 0 }}
              onClick={handleTimelineClick}
            />

            {/* ── Beat clip row ── */}
            <div
              className="relative border-b border-[#2a2a2a] overflow-hidden"
              style={{ height: TRACK_H, backgroundColor: "rgba(127,29,29,0.2)" }}
            >
              <div id="daw-yt-player" className="hidden absolute" />
              <div className="absolute inset-0 flex items-center px-2">
                <div className="flex w-full items-center gap-[1px]" style={{ height: 52 }}>
                  {BEAT_BARS.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-[1px]"
                      style={{
                        height: `${h}%`,
                        backgroundColor: `rgba(239,68,68,${isPlaying ? 0.45 + Math.sin(i * 0.5 + time * 6) * 0.08 : 0.4})`,
                        minWidth: 1,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="absolute top-1.5 left-3 z-10 flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-red-400 bg-black/50 px-1.5 py-0.5 rounded">Beat</span>
                <span className="text-[10px] text-gray-500 truncate max-w-[180px]">{beat.title}</span>
              </div>
            </div>

            {/* ── Recording lane clip rows ── */}
            {lanes.map((lane, i) => (
              <div
                key={lane.id}
                className="relative border-b border-[#1e1e1e] overflow-hidden"
                style={{
                  height: TRACK_H,
                  backgroundColor: armedLane === lane.id ? `${lane.color}06` : "#141414",
                }}
              >
                {lane.blobUrl ? (
                  <>
                    <div
                      className="absolute flex items-center overflow-hidden"
                      style={{
                        top: 8, bottom: 8, left: 8,
                        width: lane.durationSec > 0 ? lane.durationSec * zoom - 16 : "calc(100% - 16px)",
                        backgroundColor: `${lane.color}12`,
                        border: `1px solid ${lane.color}35`,
                        borderRadius: 8,
                        padding: "0 8px",
                      }}
                    >
                      <WaveCanvas data={lane.waveform} color={lane.color} zoom={zoom} durationSec={lane.durationSec} />
                    </div>
                    <div className="absolute top-2.5 left-4 z-10 flex items-center gap-1.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: lane.color, backgroundColor: `${lane.color}20` }}>
                        {lane.name}
                      </span>
                      {lane.durationSec > 0 && <span className="text-[10px] text-gray-600">{lane.durationSec.toFixed(1)}s</span>}
                    </div>
                    <audio ref={(el) => { audioEls.current[i] = el; }} src={lane.blobUrl} preload="auto" />
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    {armedLane === lane.id ? (
                      <p className="text-xs font-semibold" style={{ color: lane.color }}>
                        {isRecording ? "● Recording…" : "Armed — press ● Record in transport"}
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-800">Click ● on left to arm</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* ── Playhead ── */}
            <div
              className="absolute top-0 bottom-0 z-30 pointer-events-none"
              style={{ left: playheadPx, width: 2 }}
            >
              {/* Line */}
              <div className="absolute inset-0 bg-white/80" style={{ top: RULER_H }} />
              {/* Triangle handle in ruler */}
              <div
                className="absolute"
                style={{
                  top: RULER_H - 10,
                  left: -5,
                  width: 0, height: 0,
                  borderLeft: "6px solid transparent",
                  borderRight: "6px solid transparent",
                  borderTop: "10px solid rgba(255,255,255,0.9)",
                }}
              />
              {/* Time label */}
              <div
                className="absolute text-[9px] font-mono text-white/80 bg-black/60 px-1 rounded"
                style={{ top: RULER_H - 22, left: 4, whiteSpace: "nowrap" }}
              >
                {fmtTime(time)}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Hint bar ── */}
      <div className="h-7 bg-[#111] border-t border-[#1e1e1e] flex items-center px-4 text-[10px] text-gray-700 gap-4 shrink-0">
        <span>Click timeline to seek</span>
        <span className="text-gray-800">·</span>
        <span>● Arm a lane → ● Record</span>
        <span className="text-gray-800">·</span>
        <span>▶ Play mix</span>
        <span className="text-gray-800">·</span>
        <span>M mute · scroll to pan</span>
      </div>
    </div>
  );
}
