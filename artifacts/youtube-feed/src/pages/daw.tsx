import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "wouter";
import {
  Play, Square, Circle, Volume2, ArrowLeft,
  Loader2, Pause, SkipBack, Mic, ZoomIn, ZoomOut,
  CloudUpload, FolderOpen, Trash2, X, Check, Download, SlidersHorizontal, RotateCcw, Wand2,
} from "lucide-react";
import type { Video } from "@workspace/api-client-react";

const BEAT_KEY = "tubefeed-daw-beat";
const LANE_COLORS = ["#ef4444", "#22c55e", "#8b5cf6"];
const LANE_NAMES  = ["Vocal 1", "Vocal 2", "Vocal 3"];
const TIMELINE_SECS = 300;
const TRACK_H = 76, RULER_H = 24, LEFT_W = 208;

// ── YouTube IFrame API ────────────────────────────────────────────────────────
let _ytLoaded = false, _ytReady = false;
const _ytCbs: (() => void)[] = [];
function loadYT(cb: () => void) {
  if ((window as any).YT?.Player) { cb(); return; }
  if (_ytReady) { cb(); return; }
  _ytCbs.push(cb);
  if (_ytLoaded) return;
  _ytLoaded = true;
  const prev = (window as any).onYouTubeIframeAPIReady;
  (window as any).onYouTubeIframeAPIReady = () => {
    _ytReady = true;
    if (typeof prev === "function") prev();
    _ytCbs.forEach((f) => f()); _ytCbs.length = 0;
  };
  if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return;
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmtTime(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60), d = Math.floor((sec % 1) * 10);
  return `${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}.${d}`;
}
function fmtRuler(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2,"0")}` : `${s}s`;
}
function fmtBarBeat(sec: number, secPerBeat: number) {
  const totalBeats = sec / secPerBeat;
  const bar  = Math.floor(totalBeats / 4) + 1;
  const beat = Math.floor(totalBeats % 4) + 1;
  return `${bar}.${beat}`;
}
function rulerInterval(zoom: number) {
  const nice = [0.5,1,2,5,10,15,30,60,120,300];
  return nice.find((v) => v >= 70 / zoom) ?? 300;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Lane = {
  id: number; name: string; color: string;
  muted: boolean; volume: number;
  blobUrl: string | null; mime: string;
  waveform: number[]; durationSec: number;
  startOffset: number;
  objectPath: string | null; // set after cloud save/load
};
function makeLanes(): Lane[] {
  return LANE_NAMES.map((name, i) => ({
    id: i, name, color: LANE_COLORS[i],
    muted: false, volume: 80,
    blobUrl: null, mime: "audio/webm",
    waveform: [], durationSec: 0, startOffset: 0, objectPath: null,
  }));
}

type SavedProject = {
  id: number; name: string;
  beatVideoId: string; beatTitle: string;
  beatChannelName: string; beatThumbnailUrl: string;
  lanes: Array<{
    id: number; name: string; color: string;
    muted: boolean; volume: number;
    startOffset: number; durationSec: number;
    objectPath: string | null; mime: string;
  }>;
  createdAt: string; updatedAt: string;
};

// ── Waveform canvas ───────────────────────────────────────────────────────────
function WaveCanvas({
  data, color, widthPx, maxCanvasW = 4000,
}: { data: number[]; color: string; widthPx: number; maxCanvasW?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Cap canvas pixel width for performance; CSS stretches it to actual widthPx
  const canvasW = Math.max(1, Math.min(maxCanvasW, Math.round(widthPx)));
  useEffect(() => {
    const c = ref.current;
    if (!c || data.length === 0) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const W = c.width, H = c.height, mid = H / 2;
    ctx.clearRect(0, 0, W, H);
    const bw = W / data.length;
    ctx.fillStyle = color; ctx.globalAlpha = 0.85;
    data.forEach((v, i) => {
      const h = Math.max(2, v * mid * 1.8);
      ctx.fillRect(i * bw, mid - h / 2, Math.max(1, bw - 0.5), h);
    });
  }, [data, color, canvasW]);
  return <canvas ref={ref} width={canvasW} height={56} style={{ width: widthPx, height: "100%" }} />;
}

const BEAT_BARS = Array.from({ length: 200 }, (_, i) =>
  30 + Math.abs(Math.sin(i * 0.37) * 52 + Math.sin(i * 0.13 + 1) * 28)
);

// ── Vocal FX types ────────────────────────────────────────────────────────────
type LaneFx = {
  eq: { low: number; mid: number; high: number };
  comp: { enabled: boolean; threshold: number; ratio: number };
  autotune: { enabled: boolean; amount: number; key: string };
};
type EffectChain = {
  lowShelf: BiquadFilterNode; midPeak: BiquadFilterNode; highShelf: BiquadFilterNode;
  compressor: DynamicsCompressorNode; output: GainNode;
};
function defaultFx(): LaneFx {
  return { eq: { low: 0, mid: 0, high: 0 }, comp: { enabled: false, threshold: -18, ratio: 4 }, autotune: { enabled: false, amount: 50, key: "C Major" } };
}
const NOTE_ROOTS = ["C","Db","D","Eb","E","F","F#","G","Ab","A","Bb","B"] as const;
const MAJOR_STEPS = [0,2,4,5,7,9,11];
const MINOR_STEPS = [0,2,3,5,7,8,10];
function buildAutotuneKeys(): Record<string, number[]> {
  const keys: Record<string, number[]> = { Chromatic: [0,1,2,3,4,5,6,7,8,9,10,11] };
  NOTE_ROOTS.forEach((root, i) => {
    keys[`${root} Major`] = MAJOR_STEPS.map(v => (v + i) % 12);
    keys[`${root} Minor`] = MINOR_STEPS.map(v => (v + i) % 12);
  });
  return keys;
}
const AUTOTUNE_KEYS = buildAutotuneKeys();
function detectPitchAC(buf: Float32Array, sr: number): number | null {
  const N = Math.min(buf.length, 2048);
  let rms = 0; for (let i = 0; i < N; i++) rms += buf[i] * buf[i]; rms = Math.sqrt(rms / N);
  if (rms < 0.01) return null;
  const minL = Math.floor(sr / 900), maxL = Math.floor(sr / 60);
  let best = 0, bestLag = 0;
  for (let lag = minL; lag < maxL && lag < N / 2; lag++) {
    let c = 0; for (let i = 0; i < N / 2; i++) c += buf[i] * buf[i + lag];
    if (c > best) { best = c; bestLag = lag; }
  }
  return bestLag > 0 ? sr / bestLag : null;
}
function snapToKey(midiFloat: number, key: string): number {
  const notes = AUTOTUNE_KEYS[key] ?? AUTOTUNE_KEYS["Chromatic"];
  const octave = Math.floor(midiFloat / 12), note = midiFloat % 12;
  let bestNote = notes[0], bestDist = Infinity;
  for (const n of notes) {
    const dist = Math.min(Math.abs(n - note), 12 - Math.abs(n - note));
    if (dist < bestDist) { bestDist = dist; bestNote = n; }
  }
  return octave * 12 + bestNote;
}

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
  const [beatMuted, setBeatMuted]     = useState(false);
  const [zoom, setZoom]               = useState(50);
  // Save / Projects / Export
  const [saveState, setSaveState]     = useState<"idle"|"saving"|"saved"|"error">("idle");
  const [exportState, setExportState] = useState<"idle"|"exporting"|"done"|"error">("idle");
  const [showProjects, setShowProjects] = useState(false);
  const [projects, setProjects]       = useState<SavedProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [deletingId, setDeletingId]   = useState<number | null>(null);
  const [loadingId, setLoadingId]     = useState<number | null>(null);
  const [lanesFx, setLanesFx]         = useState<LaneFx[]>(() => [0,1,2].map(defaultFx));
  const [fxLane, setFxLane]           = useState<number | null>(null);
  const [autotuneProcessing, setAutotuneProcessing] = useState<Set<number>>(new Set());
  const [detectingKey, setDetectingKey] = useState(false);
  const [bpm, setBpm]                   = useState(120);
  const [detectingBpm, setDetectingBpm] = useState(false);
  const [bpmStatus, setBpmStatus]       = useState<"idle"|"ok"|"err">("idle");
  const [bpmErrMsg, setBpmErrMsg]       = useState("");
  const tapTimesRef                      = useRef<number[]>([]);
  const tapResetRef                      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [beatWaveform, setBeatWaveform]   = useState<number[]>([]);
  const [beatDurationSec, setBeatDurationSec] = useState(0);
  const [beatWaveStatus, setBeatWaveStatus]   = useState<"idle"|"loading"|"ready"|"err">("idle");

  const ytRef      = useRef<any>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseRef    = useRef(0);
  const timeRef    = useRef(0);
  const mrRef      = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const recLaneRef = useRef(-1);
  const audioEls   = useRef<(HTMLAudioElement | null)[]>([null, null, null]);
  const tlRef      = useRef<HTMLDivElement>(null);
  const zoomRef    = useRef(50);
  const lanesRef   = useRef(lanes);
  const schedules  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dragRef    = useRef<{ laneId: number; startX: number; origOffset: number } | null>(null);
  const isPlayingRef  = useRef(false);
  const lanesFxRef    = useRef<LaneFx[]>(lanesFx);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const srcNodesRef   = useRef<(MediaElementAudioSourceNode | null)[]>([null, null, null]);
  const chainRef      = useRef<(EffectChain | null)[]>([null, null, null]);
  const origBlobsRef  = useRef<(string | null)[]>([null, null, null]);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { lanesRef.current = lanes; }, [lanes]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { lanesFxRef.current = lanesFx; }, [lanesFx]);

  // ── Load beat from sessionStorage on mount ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BEAT_KEY);
      if (raw) { sessionStorage.removeItem(BEAT_KEY); setBeat(JSON.parse(raw)); }
    } catch { /* ignore */ }
  }, []);

  // ── Fetch beat waveform whenever beat changes ──
  useEffect(() => {
    if (!beat?.videoId) return;
    setBeatWaveform([]);
    setBeatDurationSec(0);
    setBeatWaveStatus("loading");
    const ctrl = new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/waveform/${beat.videoId}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((body: { peaks?: number[]; durationSec?: number; error?: string }) => {
        if (body.error && (!body.peaks || body.peaks.length === 0)) {
          setBeatWaveStatus("err");
        } else {
          setBeatWaveform(body.peaks ?? []);
          setBeatDurationSec(body.durationSec ?? 0);
          setBeatWaveStatus("ready");
        }
      })
      .catch((e) => { if (e?.name !== "AbortError") setBeatWaveStatus("err"); });
    return () => ctrl.abort();
  }, [beat?.videoId]);

  // ── Boot YouTube player whenever beat changes ──
  useEffect(() => {
    if (!beat) return;
    setYtReady(false);
    if (ytRef.current) {
      try { ytRef.current.destroy(); } catch (_) {}
      ytRef.current = null;
    }
    loadYT(() => {
      ytRef.current = new (window as any).YT.Player("daw-yt-player", {
        videoId: beat.videoId,
        playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0 },
        events: { onReady: () => setYtReady(true) },
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat?.videoId]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    schedules.current.forEach(clearTimeout);
    try { ytRef.current?.destroy?.(); } catch (_) {}
  }, []);

  // ── Auto-scroll playhead ──
  useEffect(() => {
    const el = tlRef.current;
    if (!el || !isPlaying) return;
    const px = timeRef.current * zoom;
    if (px > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = px - el.clientWidth / 3;
  }, [time, zoom, isPlaying]);

  // ── Drag handlers (global) ──
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const newOffset = Math.max(0, d.origOffset + dx / zoomRef.current);
      setLanes((p) => p.map((l) => l.id === d.laneId ? { ...l, startOffset: newOffset } : l));
    }
    function onUp() { dragRef.current = null; }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, []);

  // ── Spacebar play/pause ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      if (isRecording) return;
      if (isPlayingRef.current) {
        clearSchedules(); stopClock();
        try { ytRef.current?.pauseVideo?.(); } catch (_) {}
        audioEls.current.forEach((a) => { if (a) a.pause(); });
        setIsPlaying(false);
      } else {
        if (!ytReady) return;
        const t = timeRef.current;
        try { ytRef.current?.seekTo?.(t, true); ytRef.current?.playVideo?.(); } catch (_) {}
        scheduleLanes(t, lanesRef.current);
        startClock(t); setIsPlaying(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, ytReady]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function clearSchedules() {
    schedules.current.forEach(clearTimeout); schedules.current = [];
  }
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
    clearSchedules(); stopClock();
    try { ytRef.current?.stopVideo?.(); } catch (_) {}
    audioEls.current.forEach((a) => { if (a) { a.pause(); a.currentTime = 0; } });
    if (mrRef.current?.state === "recording") {
      try { mrRef.current.stop(); } catch (_) {}
    }
    mrRef.current = null;
    setIsPlaying(false); setIsRecording(false);
    setTime(0); timeRef.current = 0;
  }

  // ── Web Audio FX chain ────────────────────────────────────────────────────────
  function ensureAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }

  function buildChain(ctx: AudioContext, fx: LaneFx): EffectChain {
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = "lowshelf"; lowShelf.frequency.value = 200; lowShelf.gain.value = fx.eq.low;
    const midPeak = ctx.createBiquadFilter();
    midPeak.type = "peaking"; midPeak.frequency.value = 1000; midPeak.Q.value = 1.5; midPeak.gain.value = fx.eq.mid;
    const highShelf = ctx.createBiquadFilter();
    highShelf.type = "highshelf"; highShelf.frequency.value = 8000; highShelf.gain.value = fx.eq.high;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = fx.comp.threshold; compressor.ratio.value = fx.comp.ratio;
    compressor.knee.value = 10; compressor.attack.value = 0.005; compressor.release.value = 0.3;
    const output = ctx.createGain(); output.gain.value = 1;
    lowShelf.connect(midPeak); midPeak.connect(highShelf);
    if (fx.comp.enabled) { highShelf.connect(compressor); compressor.connect(output); }
    else { highShelf.connect(output); }
    output.connect(ctx.destination);
    return { lowShelf, midPeak, highShelf, compressor, output };
  }

  function connectLaneAudio(i: number, el: HTMLAudioElement) {
    const ctx = ensureAudioCtx();
    if (!srcNodesRef.current[i]) {
      srcNodesRef.current[i] = ctx.createMediaElementSource(el);
    }
    const src = srcNodesRef.current[i]!;
    try { src.disconnect(); } catch (_) {}
    if (chainRef.current[i]) { try { chainRef.current[i]!.output.disconnect(); } catch (_) {} }
    const chain = buildChain(ctx, lanesFxRef.current[i]);
    src.connect(chain.lowShelf);
    chainRef.current[i] = chain;
  }

  function updateFxForLane(laneId: number, updater: (fx: LaneFx) => LaneFx, rebuildChain = false) {
    setLanesFx((prev) => {
      const next = prev.map((fx, i) => i === laneId ? updater(fx) : fx);
      lanesFxRef.current = next;
      const chain = chainRef.current[laneId];
      const ctx = audioCtxRef.current;
      if (chain && ctx && !rebuildChain) {
        const nfx = next[laneId]; const now = ctx.currentTime;
        chain.lowShelf.gain.setValueAtTime(nfx.eq.low, now);
        chain.midPeak.gain.setValueAtTime(nfx.eq.mid, now);
        chain.highShelf.gain.setValueAtTime(nfx.eq.high, now);
        if (nfx.comp.enabled) {
          chain.compressor.threshold.setValueAtTime(nfx.comp.threshold, now);
          chain.compressor.ratio.setValueAtTime(nfx.comp.ratio, now);
        }
      }
      return next;
    });
    if (rebuildChain) {
      const el = audioEls.current[laneId];
      if (el) setTimeout(() => connectLaneAudio(laneId, el), 0);
    }
  }

  function scheduleLanes(t: number, ls: Lane[]) {
    clearSchedules();
    // Route each audio element through its FX chain
    ls.forEach((lane, i) => {
      const a = audioEls.current[i];
      if (a && lane.blobUrl) connectLaneAudio(i, a);
    });
    ls.forEach((lane, i) => {
      const a = audioEls.current[i];
      if (!a || !lane.blobUrl || lane.muted) return;
      a.volume = lane.volume / 100;
      const delayMs = Math.max(0, (lane.startOffset - t) * 1000);
      const audioPos = Math.max(0, t - lane.startOffset);
      if (t < lane.startOffset) {
        a.pause();
        const tid = setTimeout(() => { a.currentTime = 0; a.play().catch(() => {}); }, delayMs);
        schedules.current.push(tid);
      } else {
        a.currentTime = Math.min(audioPos, a.duration || 0);
        a.play().catch(() => {});
      }
    });
  }

  async function decodeWaveform(blob: Blob, laneId: number) {
    try {
      const ac = new AudioContext();
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      const raw = buf.getChannelData(0);
      const N = 300, blk = Math.floor(raw.length / N);
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

  async function decodeWaveformFromUrl(url: string, laneId: number) {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      decodeWaveform(blob, laneId);
    } catch { /* ignore */ }
  }

  // ── WAV export ───────────────────────────────────────────────────────────────
  function writeWavString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  function audioBufferToWav(buf: AudioBuffer): ArrayBuffer {
    const numCh = buf.numberOfChannels, sr = buf.sampleRate, len = buf.length;
    const bps = 16, blockAlign = numCh * 2, byteRate = sr * blockAlign;
    const dataSize = len * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);
    writeWavString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeWavString(view, 8, "WAVE");
    writeWavString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bps, true);
    writeWavString(view, 36, "data");
    view.setUint32(40, dataSize, true);
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const s = Math.max(-1, Math.min(1, buf.getChannelData(ch)[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return ab;
  }

  async function handleExport() {
    const activeLanes = lanesRef.current.filter((l) => !l.muted && l.blobUrl);
    if (activeLanes.length === 0) return;
    setExportState("exporting");
    try {
      // Determine the total rendered duration
      const totalDur = activeLanes.reduce(
        (max, l) => Math.max(max, l.startOffset + l.durationSec),
        0
      ) + 0.5;
      const sampleRate = 44100;
      const offCtx = new OfflineAudioContext(2, Math.ceil(totalDur * sampleRate), sampleRate);
      // Decode and schedule every active lane
      await Promise.all(
        activeLanes.map(async (lane) => {
          const resp = await fetch(lane.blobUrl!);
          const rawBuf = await resp.arrayBuffer();
          const audioBuf = await offCtx.decodeAudioData(rawBuf);
          const src = offCtx.createBufferSource();
          src.buffer = audioBuf;
          const gain = offCtx.createGain();
          gain.gain.value = lane.volume / 100;
          src.connect(gain);
          gain.connect(offCtx.destination);
          src.start(lane.startOffset);
        })
      );
      const rendered = await offCtx.startRendering();
      const wav = audioBufferToWav(rendered);
      const blob = new Blob([wav], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(beat?.title ?? "project").slice(0, 40).replace(/[^a-z0-9_\- ]/gi, "")}_mix.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportState("done");
      setTimeout(() => setExportState("idle"), 3000);
    } catch {
      setExportState("error");
      setTimeout(() => setExportState("idle"), 3000);
    }
  }

  // ── Cloud save ───────────────────────────────────────────────────────────────
  async function uploadBlob(blobUrl: string, mime: string): Promise<string> {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    // Step 1: request presigned URL
    const urlRes = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "vocal.webm", size: blob.size, contentType: mime }),
    });
    const { uploadURL, objectPath } = await urlRes.json();
    // Step 2: PUT directly to GCS
    await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": mime }, body: blob });
    return objectPath as string;
  }

  async function handleSave() {
    if (!beat) return;
    setSaveState("saving");
    try {
      // Upload all recorded lanes in parallel
      const lanesSave = await Promise.all(
        lanesRef.current.map(async (lane) => {
          let objectPath = lane.objectPath;
          if (lane.blobUrl && lane.blobUrl.startsWith("blob:")) {
            objectPath = await uploadBlob(lane.blobUrl, lane.mime);
          }
          return {
            id: lane.id,
            name: lane.name,
            color: lane.color,
            muted: lane.muted,
            volume: lane.volume,
            startOffset: lane.startOffset,
            durationSec: lane.durationSec,
            objectPath: objectPath ?? null,
            mime: lane.mime,
          };
        })
      );
      // Persist objectPaths back to state so subsequent saves skip re-upload
      setLanes((p) => p.map((l) => {
        const saved = lanesSave.find((s) => s.id === l.id);
        return saved ? { ...l, objectPath: saved.objectPath } : l;
      }));
      const name = `${beat.title.slice(0, 40)} | ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
      await fetch("/api/daw/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          beatVideoId: beat.videoId,
          beatTitle: beat.title,
          beatChannelName: beat.channelName,
          beatThumbnailUrl: beat.thumbnailUrl,
          lanes: lanesSave,
        }),
      });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 3000);
      // Refresh projects list if panel is open
      if (showProjects) fetchProjects();
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  // ── Autotune (offline pitch correction) ─────────────────────────────────────
  async function applyAutotune(laneId: number) {
    const lane = lanesRef.current[laneId];
    if (!lane?.blobUrl) return;
    const fx = lanesFxRef.current[laneId];
    setAutotuneProcessing((p) => new Set([...p, laneId]));
    try {
      const resp = await fetch(lane.blobUrl);
      const arrayBuf = await resp.arrayBuffer();
      const tempCtx = new AudioContext();
      const audioBuf = await tempCtx.decodeAudioData(arrayBuf);
      await tempCtx.close();
      const chData = audioBuf.getChannelData(0);
      const frameSize = 2048;
      const pitches: number[] = [];
      for (let s = 0; s < chData.length - frameSize * 2; s += frameSize) {
        const frame = chData.slice(s, s + frameSize);
        const p = detectPitchAC(frame, audioBuf.sampleRate);
        if (p !== null) pitches.push(p);
      }
      if (pitches.length === 0) {
        setAutotuneProcessing((p) => { const n = new Set(p); n.delete(laneId); return n; });
        return;
      }
      pitches.sort((a, b) => a - b);
      const medPitch = pitches[Math.floor(pitches.length / 2)];
      const midiF = 12 * Math.log2(medPitch / 440) + 69;
      const snapped = snapToKey(midiF, fx.autotune.key);
      const corrCents = (snapped - midiF) * 100 * (fx.autotune.amount / 100);
      if (Math.abs(corrCents) < 1) {
        setAutotuneProcessing((p) => { const n = new Set(p); n.delete(laneId); return n; });
        return;
      }
      const offCtx = new OfflineAudioContext(audioBuf.numberOfChannels, audioBuf.length, audioBuf.sampleRate);
      const src = offCtx.createBufferSource();
      src.buffer = audioBuf; src.detune.value = corrCents;
      src.connect(offCtx.destination); src.start(0);
      const rendered = await offCtx.startRendering();
      origBlobsRef.current[laneId] = lane.blobUrl;
      const wav = audioBufferToWav(rendered);
      const blob = new Blob([wav], { type: "audio/wav" });
      const newUrl = URL.createObjectURL(blob);
      setLanes((p) => p.map((l) => l.id === laneId ? { ...l, blobUrl: newUrl, mime: "audio/wav", objectPath: null } : l));
      decodeWaveform(blob, laneId);
    } catch { /* ignore */ }
    setAutotuneProcessing((p) => { const n = new Set(p); n.delete(laneId); return n; });
  }

  function revertAutotune(laneId: number) {
    const orig = origBlobsRef.current[laneId];
    if (!orig) return;
    setLanes((p) => p.map((l) => l.id === laneId ? { ...l, blobUrl: orig, mime: "audio/webm", objectPath: null } : l));
    decodeWaveformFromUrl(orig, laneId);
    origBlobsRef.current[laneId] = null;
    updateFxForLane(laneId, (fx) => ({ ...fx, autotune: { ...fx.autotune, enabled: false } }));
  }

  // ── Detect key from beat audio ───────────────────────────────────────────────
  async function detectBeatKey(laneId: number) {
    if (!beat?.videoId) return;
    setDetectingKey(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/detect-key/${beat.videoId}`);
      if (!res.ok) throw new Error("detection failed");
      const { note, mode } = await res.json() as { note: string; mode: string };
      updateFxForLane(laneId, (fx) => ({ ...fx, autotune: { ...fx.autotune, key: `${note} ${mode}` } }));
    } catch { /* silent */ }
    setDetectingKey(false);
  }

  // ── Detect BPM from beat audio ────────────────────────────────────────────────
  async function detectBeatBpm() {
    if (!beat?.videoId) return;
    setDetectingBpm(true);
    setBpmStatus("idle");
    setBpmErrMsg("");
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/detect-bpm/${beat.videoId}`);
      const body = await res.json() as { bpm?: number; error?: string };
      if (!res.ok || body.error) {
        const msg = body.error ?? "Detection failed";
        const friendly = msg.includes("Sign in") || msg.includes("bot")
          ? "YouTube blocked this video — try a different beat"
          : msg.includes("No audio")
          ? "Could not download audio for this video"
          : "BPM detection failed";
        setBpmErrMsg(friendly);
        setBpmStatus("err");
        setTimeout(() => setBpmStatus("idle"), 4000);
      } else if (body.bpm && body.bpm > 0) {
        setBpm(body.bpm);
        setBpmStatus("ok");
        setTimeout(() => setBpmStatus("idle"), 3000);
      } else {
        setBpmErrMsg("Could not determine BPM");
        setBpmStatus("err");
        setTimeout(() => setBpmStatus("idle"), 4000);
      }
    } catch {
      setBpmErrMsg("Network error");
      setBpmStatus("err");
      setTimeout(() => setBpmStatus("idle"), 4000);
    }
    setDetectingBpm(false);
  }

  // ── Tap BPM ──────────────────────────────────────────────────────────────────
  function tapBpm() {
    const now = performance.now();
    if (tapResetRef.current) clearTimeout(tapResetRef.current);
    tapResetRef.current = setTimeout(() => { tapTimesRef.current = []; }, 3000);

    tapTimesRef.current.push(now);
    const taps = tapTimesRef.current;
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]);
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const detected = Math.round(60000 / avgMs);
      if (detected >= 40 && detected <= 280) {
        setBpm(detected);
        setBpmStatus("ok");
        if (tapTimesRef.current.length >= 2) {
          setTimeout(() => setBpmStatus("idle"), 2000);
        }
      }
    }
  }

  // ── Projects panel ───────────────────────────────────────────────────────────
  async function fetchProjects() {
    setProjectsLoading(true);
    try {
      const res = await fetch("/api/daw/projects");
      setProjects(await res.json());
    } catch { /* ignore */ }
    setProjectsLoading(false);
  }

  function openProjects() {
    setShowProjects(true);
    fetchProjects();
  }

  async function handleLoadProject(project: SavedProject) {
    setLoadingId(project.id);
    stopAll();
    // Restore beat
    const newBeat: Video = {
      videoId: project.beatVideoId,
      title: project.beatTitle,
      channelName: project.beatChannelName,
      thumbnailUrl: project.beatThumbnailUrl,
      description: "",
      publishedAt: new Date().toISOString(),
      channelId: "",
    };
    setBeat(newBeat);
    setArmedLane(-1);
    // Restore lanes (objectPaths → blobUrls)
    const restoredLanes: Lane[] = LANE_NAMES.map((name, i) => {
      const saved = project.lanes.find((l) => l.id === i);
      const audioUrl = saved?.objectPath ? `/api/storage${saved.objectPath}` : null;
      return {
        id: i, name: saved?.name ?? name, color: saved?.color ?? LANE_COLORS[i],
        muted: saved?.muted ?? false, volume: saved?.volume ?? 80,
        blobUrl: audioUrl,
        mime: saved?.mime ?? "audio/webm",
        waveform: [], durationSec: saved?.durationSec ?? 0,
        startOffset: saved?.startOffset ?? 0,
        objectPath: saved?.objectPath ?? null,
      };
    });
    setLanes(restoredLanes);
    // Decode waveforms in background
    restoredLanes.forEach((lane) => {
      if (lane.blobUrl) decodeWaveformFromUrl(lane.blobUrl, lane.id);
    });
    setLoadingId(null);
    setShowProjects(false);
  }

  async function handleDeleteProject(id: number) {
    setDeletingId(id);
    try {
      await fetch(`/api/daw/projects/${id}`, { method: "DELETE" });
      setProjects((p) => p.filter((proj) => proj.id !== id));
    } catch { /* ignore */ }
    setDeletingId(null);
  }

  // ── Transport ─────────────────────────────────────────────────────────────────
  async function handleRecord() {
    if (armedLane < 0 || !ytReady) return;
    stopAll(); setMicError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const mr     = new MediaRecorder(stream, { mimeType: mime });
      mrRef.current = mr; chunksRef.current = []; recLaneRef.current = armedLane;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        const url  = URL.createObjectURL(blob);
        const lid  = recLaneRef.current;
        setLanes((p) => p.map((l) => l.id === lid
          ? { ...l, blobUrl: url, mime, startOffset: 0, objectPath: null }
          : l
        ));
        stream.getTracks().forEach((t) => t.stop());
        decodeWaveform(blob, lid);
      };
      mr.start(100);
      ytRef.current.seekTo(0, true); ytRef.current.playVideo();
      if (beatMuted) ytRef.current.mute();
      startClock(0);
      setIsRecording(true); setIsPlaying(true);
    } catch { setMicError(true); }
  }

  function handlePlay() {
    if (isPlaying) return;
    const t = timeRef.current;
    try { ytRef.current?.seekTo?.(t, true); ytRef.current?.playVideo?.(); } catch (_) {}
    scheduleLanes(t, lanesRef.current);
    startClock(t); setIsPlaying(true);
  }

  function handlePause() {
    clearSchedules(); stopClock();
    try { ytRef.current?.pauseVideo?.(); } catch (_) {}
    audioEls.current.forEach((a) => { if (a) a.pause(); });
    setIsPlaying(false);
  }

  function seekTo(sec: number) {
    const t = Math.max(0, Math.min(sec, TIMELINE_SECS));
    setTime(t); timeRef.current = t;
    if (isPlaying) {
      try { ytRef.current?.seekTo?.(t, true); } catch (_) {}
      scheduleLanes(t, lanesRef.current);
      baseRef.current = Date.now() - t * 1000;
    }
  }

  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if (isRecording) return;
    const el = tlRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    seekTo((e.clientX - rect.left + el.scrollLeft) / zoom);
  }

  // ── BPM grid ─────────────────────────────────────────────────────────────────
  const secPerBeat = 60 / bpm;
  const beatPx     = secPerBeat * zoom;   // pixels per beat

  const beatTicks = useMemo(() => {
    const spb = 60 / bpm;
    const total = Math.ceil(TIMELINE_SECS / spb) + 1;
    const out: { i: number; sec: number; isBar: boolean; bar: number; beatInBar: number }[] = [];
    for (let i = 0; i < total; i++) {
      const sec = i * spb;
      if (sec > TIMELINE_SECS) break;
      out.push({ i, sec, isBar: i % 4 === 0, bar: Math.floor(i / 4) + 1, beatInBar: (i % 4) + 1 });
    }
    return out;
  }, [bpm]);

  // Only show beat lines when there's enough room, only show sub-beat at high zoom
  const showBeatLines  = beatPx >= 10;
  const showSubBeats   = beatPx >= 44;

  // ── Ruler ─────────────────────────────────────────────────────────────────────
  const totalWidth = TIMELINE_SECS * zoom;
  const playheadPx = time * zoom;

  const hasAnyRecording = lanes.some((l) => l.blobUrl !== null);

  if (!beat) {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex flex-col items-center justify-center gap-4 text-white">
        <Mic className="w-12 h-12 text-gray-600" />
        <p className="text-gray-400 text-sm">No beat loaded.</p>
        <p className="text-gray-600 text-xs">Go to Beats, open a beat, then click "Open DAW".</p>
        <div className="flex items-center gap-3 mt-2">
          <Link href="/beats">
            <span className="inline-flex items-center px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-sm cursor-pointer transition-colors">
              Browse Beats
            </span>
          </Link>
          <button
            onClick={openProjects}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-sm transition-colors"
          >
            <FolderOpen className="w-4 h-4" /> Open Saved Project
          </button>
        </div>
        {/* Projects panel (no-beat state) */}
        {showProjects && (
          <ProjectsPanel
            projects={projects} loading={projectsLoading}
            deletingId={deletingId} loadingId={loadingId}
            onClose={() => setShowProjects(false)}
            onLoad={handleLoadProject} onDelete={handleDeleteProject}
          />
        )}
      </div>
    );
  }

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

        {/* Playback controls */}
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

        {/* Time display */}
        <div className="font-mono text-lg text-white tabular-nums bg-black/40 px-3 py-1 rounded-lg border border-[#2a2a2a] min-w-[90px] text-center">
          {fmtTime(time)}
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(8, z * 0.6))} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ZoomOut className="w-4 h-4 text-gray-400" />
          </button>
          <span className="text-[10px] text-gray-600 w-12 text-center tabular-nums">{Math.round(zoom)}px/s</span>
          <button onClick={() => setZoom((z) => Math.min(400, z * 1.667))} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ZoomIn className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* BPM */}
        <div
          title={bpmStatus === "err" ? bpmErrMsg : undefined}
          className={`flex items-center gap-0.5 px-2 py-1 rounded-lg border transition-colors ${
          detectingBpm ? "bg-violet-950/60 border-violet-700/60" :
          bpmStatus === "ok" ? "bg-green-950/60 border-green-700/60" :
          bpmStatus === "err" ? "bg-red-950/60 border-red-700/60" :
          "bg-black/40 border-[#2a2a2a]"
        }`}>
          {detectingBpm ? (
            <span className="flex items-center gap-1.5 text-[10px] text-violet-300 px-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Analyzing beat…
            </span>
          ) : (
            <>
              <button
                onClick={() => setBpm((b) => Math.max(40, b - 1))}
                className="text-gray-500 hover:text-white w-4 text-center leading-none select-none"
              >−</button>
              <span className={`text-[11px] font-mono tabular-nums w-8 text-center ${bpmStatus === "ok" ? "text-green-300" : bpmStatus === "err" ? "text-red-400" : "text-white"}`}>
                {bpmStatus === "err" ? "Err" : bpm}
              </span>
              <button
                onClick={() => setBpm((b) => Math.min(300, b + 1))}
                className="text-gray-500 hover:text-white w-4 text-center leading-none select-none"
              >+</button>
              <span className={`text-[10px] ml-0.5 ${bpmStatus === "ok" ? "text-green-500" : bpmStatus === "err" ? "text-red-500" : "text-gray-600"}`}>
                {bpmStatus === "ok" ? "✓ BPM" : bpmStatus === "err" ? "blocked" : "BPM"}
              </span>
              <button
                onClick={tapBpm}
                title="Tap to the beat to set BPM"
                className="ml-1.5 px-1.5 py-0.5 text-[9px] font-bold text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors select-none"
              >
                TAP
              </button>
              <button
                onClick={detectBeatBpm}
                disabled={!beat}
                title="Auto-detect BPM from beat audio (~30s)"
                className="text-violet-400 hover:text-violet-300 disabled:opacity-40 transition-colors"
              >
                <Wand2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>

        {/* Beat info */}
        <div className="flex items-center gap-2 ml-1 min-w-0 flex-1">
          <img src={beat.thumbnailUrl} className="w-8 h-8 rounded object-cover shrink-0 border border-[#333]" alt="" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white/90 truncate leading-tight">{beat.title}</p>
            <p className="text-[10px] text-gray-500 truncate">{beat.channelName}</p>
          </div>
        </div>

        {/* Status + Save + Projects */}
        <div className="shrink-0 flex items-center gap-2">
          {!ytReady && <span className="flex items-center gap-1 text-gray-500 text-xs"><Loader2 className="w-3 h-3 animate-spin" />Loading…</span>}
          {micError && <span className="text-red-400 text-xs">Mic denied</span>}
          {isRecording && <span className="flex items-center gap-1.5 text-red-400 font-bold text-xs animate-pulse"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />REC</span>}

          {/* Projects button */}
          <button
            onClick={openProjects}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/10 border border-[#2a2a2a] text-gray-400 hover:text-white transition-colors text-xs"
          >
            <FolderOpen className="w-3.5 h-3.5" />Projects
          </button>

          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={!hasAnyRecording || exportState === "exporting"}
            title={!hasAnyRecording ? "Record something first" : "Export mix as WAV"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors disabled:opacity-40 ${
              exportState === "done"      ? "bg-green-600 text-white" :
              exportState === "error"     ? "bg-red-600 text-white" :
              exportState === "exporting" ? "bg-purple-600/50 text-purple-300" :
              "bg-purple-700 hover:bg-purple-600 text-white"
            }`}
          >
            {exportState === "exporting" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
             exportState === "done"      ? <Check className="w-3.5 h-3.5" /> :
             <Download className="w-3.5 h-3.5" />}
            {exportState === "exporting" ? "Rendering…" : exportState === "done" ? "Downloaded!" : exportState === "error" ? "Error" : "Export"}
          </button>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={!hasAnyRecording || saveState === "saving"}
            title={!hasAnyRecording ? "Record something first" : "Save project to cloud"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors disabled:opacity-40 ${
              saveState === "saved" ? "bg-green-600 text-white" :
              saveState === "error" ? "bg-red-600 text-white" :
              saveState === "saving" ? "bg-blue-600/50 text-blue-300" :
              "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {saveState === "saving" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
             saveState === "saved"  ? <Check className="w-3.5 h-3.5" /> :
             <CloudUpload className="w-3.5 h-3.5" />}
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved!" : saveState === "error" ? "Error" : "Save"}
          </button>
        </div>
      </div>

      {/* ── Main track area ── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* Left panels */}
        <div className="shrink-0 flex flex-col border-r border-[#2a2a2a] bg-[#161616]" style={{ width: LEFT_W }}>
          <div className="shrink-0 border-b border-[#2a2a2a] flex items-center px-3" style={{ height: RULER_H }}>
            <span className="text-[9px] text-gray-600 font-bold uppercase tracking-widest">Track</span>
          </div>

          {/* Beat panel */}
          <div className="shrink-0 flex items-center gap-2 px-3 bg-[#1a1a1a] border-b border-[#2a2a2a]" style={{ height: TRACK_H }}>
            <img src={beat.thumbnailUrl} className="w-9 h-9 rounded-lg object-cover shrink-0 border border-[#333]" alt="" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-gray-300 truncate">Beat</p>
              <p className="text-[10px] text-gray-600 truncate">{beat.channelName}</p>
            </div>
            <button
              onClick={() => {
                const next = !beatMuted; setBeatMuted(next);
                try { next ? ytRef.current?.mute?.() : ytRef.current?.unMute?.(); } catch (_) {}
              }}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all shrink-0 border"
              style={beatMuted
                ? { backgroundColor: "rgba(234,179,8,0.15)", borderColor: "rgba(234,179,8,0.4)", color: "#eab308" }
                : { borderColor: "#2a2a2a", color: "#555" }}
            >M</button>
          </div>

          {/* Lane panels */}
          {lanes.map((lane) => (
            <div
              key={lane.id}
              className="shrink-0 flex items-center gap-2 px-3 border-b border-[#222] transition-colors"
              style={{ height: TRACK_H, backgroundColor: armedLane === lane.id ? `${lane.color}0a` : "#181818" }}
            >
              <button
                onClick={() => setArmedLane((p) => p === lane.id ? -1 : lane.id)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all shrink-0 border"
                style={armedLane === lane.id ? { backgroundColor: "#dc2626", borderColor: "#ef4444" } : { borderColor: "#2a2a2a", color: "#666" }}
              >
                <Circle className="w-3 h-3" style={{ color: armedLane === lane.id ? "white" : "#666" }} fill={armedLane === lane.id ? "white" : "none"} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold truncate mb-1" style={{ color: lane.blobUrl ? lane.color : "#ccc" }}>{lane.name}</p>
                <div className="flex items-center gap-1">
                  <Volume2 className="w-2.5 h-2.5 text-gray-700 shrink-0" />
                  <input
                    type="range" min={0} max={100} value={lane.volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLanes((p) => p.map((l) => l.id === lane.id ? { ...l, volume: v } : l));
                      const a = audioEls.current[lane.id]; if (a) a.volume = v / 100;
                    }}
                    className="flex-1 h-1 cursor-pointer min-w-0" style={{ accentColor: lane.color }}
                  />
                  <span className="text-[9px] text-gray-600 w-6 text-right shrink-0">{lane.volume}</span>
                </div>
              </div>
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => setLanes((p) => p.map((l) => l.id === lane.id ? { ...l, muted: !l.muted } : l))}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold transition-all border"
                  style={lane.muted
                    ? { backgroundColor: "rgba(234,179,8,0.15)", borderColor: "rgba(234,179,8,0.4)", color: "#eab308" }
                    : { borderColor: "#2a2a2a", color: "#555" }}
                  title="Mute"
                >M</button>
                <button
                  onClick={(e) => { e.stopPropagation(); setFxLane((p) => p === lane.id ? null : lane.id); }}
                  className="w-6 h-6 rounded-md flex items-center justify-center transition-all border"
                  style={fxLane === lane.id
                    ? { backgroundColor: "rgba(139,92,246,0.2)", borderColor: "rgba(139,92,246,0.5)", color: "#a78bfa" }
                    : { borderColor: "#2a2a2a", color: "#555" }}
                  title="Vocal FX"
                >
                  <SlidersHorizontal className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div
          ref={tlRef}
          className="flex-1 overflow-x-auto overflow-y-hidden relative"
          style={{ cursor: isRecording ? "not-allowed" : "crosshair" }}
        >
          <div style={{ width: totalWidth, position: "relative", minHeight: "100%" }}>

            {/* Ruler — bar/beat grid */}
            <div
              className="sticky top-0 z-20 bg-[#161616] border-b border-[#2a2a2a] overflow-hidden"
              style={{ height: RULER_H }}
              onClick={handleTimelineClick}
            >
              {beatTicks
                .filter(({ isBar }) => isBar || showBeatLines)
                .map(({ i, sec, isBar, bar, beatInBar }) => (
                  <div key={i} className="absolute top-0" style={{ left: sec * zoom }}>
                    {/* tick line */}
                    <div
                      className="absolute w-px"
                      style={{
                        top: isBar ? 0 : RULER_H / 2,
                        height: isBar ? RULER_H : RULER_H / 2,
                        backgroundColor: isBar ? "#505050" : "#303030",
                      }}
                    />
                    {/* bar number */}
                    {isBar && (
                      <span
                        className="absolute text-[9px] font-mono text-gray-400 leading-none"
                        style={{ left: 3, top: 3 }}
                      >
                        {bar}
                      </span>
                    )}
                    {/* beat number inside bar (only at high zoom) */}
                    {!isBar && beatPx >= 30 && (
                      <span
                        className="absolute text-[8px] font-mono text-gray-700 leading-none"
                        style={{ left: 3, bottom: 3 }}
                      >
                        {beatInBar}
                      </span>
                    )}
                  </div>
                ))
              }
              {/* 16th-note sub-beat ticks at very high zoom */}
              {showSubBeats && beatTicks.flatMap(({ i, sec }) =>
                [1, 2, 3].map((j) => {
                  const subSec = sec + j * secPerBeat / 4;
                  if (subSec >= TIMELINE_SECS) return null;
                  return (
                    <div
                      key={`sub-${i}-${j}`}
                      className="absolute bottom-0 w-px"
                      style={{ left: subSec * zoom, height: 5, backgroundColor: "#222" }}
                    />
                  );
                })
              )}
            </div>

            {/* Click-to-seek overlay */}
            <div className="absolute z-10" style={{ top: RULER_H, left: 0, right: 0, bottom: 0 }} onClick={handleTimelineClick} />

            {/* Beat clip row */}
            <div className="relative border-b border-[#2a2a2a] overflow-hidden" style={{ height: TRACK_H, backgroundColor: "rgba(127,29,29,0.2)" }}>
              {/* BPM grid */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {beatTicks.filter(({ isBar }) => isBar || showBeatLines).map(({ i, sec, isBar }) => (
                  <div key={i} className="absolute top-0 bottom-0 w-px" style={{
                    left: sec * zoom,
                    backgroundColor: isBar ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.035)",
                  }} />
                ))}
                {showSubBeats && beatTicks.flatMap(({ i, sec }) =>
                  [1, 2, 3].map((j) => {
                    const subSec = sec + j * secPerBeat / 4;
                    if (subSec >= TIMELINE_SECS) return null;
                    return <div key={`s-${i}-${j}`} className="absolute top-0 bottom-0 w-px" style={{ left: subSec * zoom, backgroundColor: "rgba(255,255,255,0.012)" }} />;
                  })
                )}
              </div>
              <div id="daw-yt-player" className="hidden absolute" />
              {/* Beat waveform */}
              {beatWaveStatus === "loading" ? (
                <div className="absolute inset-0 flex items-center px-3 pointer-events-none">
                  <div className="w-full h-8 rounded bg-red-900/30 overflow-hidden relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-red-700/20 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" style={{ backgroundSize: "200% 100%" }} />
                  </div>
                </div>
              ) : beatWaveStatus === "ready" && beatWaveform.length > 0 ? (
                <div
                  className="absolute pointer-events-none overflow-hidden"
                  style={{ top: 7, bottom: 7, left: 0, width: Math.max(beatDurationSec * zoom, (tlRef.current?.clientWidth ?? 0) + (tlRef.current?.scrollLeft ?? 0)) }}
                >
                  <div className="w-full h-full rounded overflow-hidden" style={{ backgroundColor: "rgba(239,68,68,0.07)", borderRight: "1px solid rgba(239,68,68,0.25)" }}>
                    <WaveCanvas
                      data={beatWaveform}
                      color="#ef4444"
                      widthPx={Math.max(beatDurationSec * zoom, (tlRef.current?.clientWidth ?? 800))}
                      maxCanvasW={3000}
                    />
                  </div>
                </div>
              ) : (
                /* Fallback decorative bars when waveform unavailable */
                <div className="absolute inset-0 flex items-center px-2 pointer-events-none">
                  <div className="flex w-full items-center gap-[1px]" style={{ height: 52 }}>
                    {BEAT_BARS.map((h, i) => (
                      <div key={i} className="flex-1 rounded-[1px]" style={{
                        height: `${h}%`, minWidth: 1,
                        backgroundColor: `rgba(239,68,68,${isPlaying ? 0.45 + Math.sin(i * 0.5 + time * 6) * 0.08 : 0.4})`,
                      }} />
                    ))}
                  </div>
                </div>
              )}
              <div className="absolute top-1.5 left-3 z-10 flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-red-400 bg-black/50 px-1.5 py-0.5 rounded">Beat</span>
                <span className="text-[10px] text-gray-500 truncate max-w-[180px]">{beat.title}</span>
              </div>
            </div>

            {/* Lane clip rows */}
            {lanes.map((lane, i) => {
              const clipW = lane.durationSec > 0 ? lane.durationSec * zoom : 120;
              const clipLeft = lane.startOffset * zoom;
              return (
                <div
                  key={lane.id}
                  className="relative border-b border-[#1e1e1e]"
                  style={{ height: TRACK_H, backgroundColor: armedLane === lane.id ? `${lane.color}06` : "#141414" }}
                >
                  {/* BPM grid */}
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    {beatTicks.filter(({ isBar }) => isBar || showBeatLines).map(({ i: bi, sec, isBar }) => (
                      <div key={bi} className="absolute top-0 bottom-0 w-px" style={{
                        left: sec * zoom,
                        backgroundColor: isBar ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.025)",
                      }} />
                    ))}
                    {showSubBeats && beatTicks.flatMap(({ i: bi, sec }) =>
                      [1, 2, 3].map((j) => {
                        const subSec = sec + j * secPerBeat / 4;
                        if (subSec >= TIMELINE_SECS) return null;
                        return <div key={`s-${bi}-${j}`} className="absolute top-0 bottom-0 w-px" style={{ left: subSec * zoom, backgroundColor: "rgba(255,255,255,0.008)" }} />;
                      })
                    )}
                  </div>
                  {lane.blobUrl ? (
                    <>
                      <div
                        className="absolute z-20"
                        style={{ top: 8, bottom: 8, left: clipLeft, width: clipW }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          dragRef.current = { laneId: lane.id, startX: e.clientX, origOffset: lane.startOffset };
                        }}
                      >
                        <div
                          className="w-full h-full rounded-lg overflow-hidden flex items-center px-2"
                          style={{
                            backgroundColor: `${lane.color}14`,
                            border: `1px solid ${lane.color}40`,
                            cursor: "grab",
                          }}
                        >
                          <WaveCanvas data={lane.waveform} color={lane.color} widthPx={Math.max(1, clipW - 16)} />
                        </div>
                        <div className="absolute top-1.5 left-2.5 flex items-center gap-1 z-10 pointer-events-none">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: lane.color, backgroundColor: `${lane.color}25` }}>
                            {lane.name}
                          </span>
                          {lane.durationSec > 0 && <span className="text-[10px] text-gray-600">{lane.durationSec.toFixed(1)}s</span>}
                          {lane.objectPath && <span className="text-[9px] text-blue-400/60">☁</span>}
                        </div>
                      </div>
                      <audio ref={(el) => { audioEls.current[i] = el; }} src={lane.blobUrl} preload="auto" />
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      {armedLane === lane.id ? (
                        <p className="text-xs font-semibold" style={{ color: lane.color }}>
                          {isRecording ? "● Recording…" : "Armed — press ● Record"}
                        </p>
                      ) : (
                        <p className="text-[11px] text-gray-800">Click ● on left to arm</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Playhead */}
            <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: playheadPx, width: 2 }}>
              <div className="absolute inset-0 bg-white/80" style={{ top: RULER_H }} />
              <div className="absolute" style={{
                top: RULER_H - 10, left: -5, width: 0, height: 0,
                borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
                borderTop: "10px solid rgba(255,255,255,0.9)",
              }} />
              <div className="absolute text-[9px] font-mono text-white/80 bg-black/60 px-1 rounded" style={{ top: RULER_H - 22, left: 4, whiteSpace: "nowrap" }}>
                {fmtBarBeat(time, secPerBeat)} · {fmtTime(time)}
              </div>
            </div>
          </div>
        </div>

        {/* Projects slide panel */}
        {showProjects && (
          <ProjectsPanel
            projects={projects} loading={projectsLoading}
            deletingId={deletingId} loadingId={loadingId}
            onClose={() => setShowProjects(false)}
            onLoad={handleLoadProject} onDelete={handleDeleteProject}
          />
        )}

        {/* FX panel */}
        {fxLane !== null && !showProjects && (
          <FxPanel
            lane={lanes[fxLane]}
            fx={lanesFx[fxLane]}
            processing={autotuneProcessing.has(fxLane)}
            hasOriginal={origBlobsRef.current[fxLane] !== null}
            hasBeat={!!beat}
            detectingKey={detectingKey}
            onClose={() => setFxLane(null)}
            onFxChange={(updater, rebuild) => updateFxForLane(fxLane!, updater, rebuild)}
            onApplyAutotune={() => applyAutotune(fxLane!)}
            onRevertAutotune={() => revertAutotune(fxLane!)}
            onDetectKey={() => detectBeatKey(fxLane!)}
          />
        )}
      </div>

      {/* Hint bar */}
      <div className="h-7 bg-[#111] border-t border-[#1e1e1e] flex items-center px-4 text-[10px] text-gray-700 gap-4 shrink-0">
        <span>Space = play/pause</span><span className="text-gray-800">·</span>
        <span>Click timeline to seek</span><span className="text-gray-800">·</span>
        <span>Drag clips to reposition</span><span className="text-gray-800">·</span>
        <span>● Arm → ● Record</span><span className="text-gray-800">·</span>
        <span>FX button = EQ · Compression · Autotune per lane</span><span className="text-gray-800">·</span>
        <span>Export = WAV mixdown</span>
      </div>
    </div>
  );
}

// ── FX Panel ──────────────────────────────────────────────────────────────────
function FxSlider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-10 shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 cursor-pointer accent-violet-500"
        style={{ background: `linear-gradient(to right, #8b5cf6 ${pct}%, #333 ${pct}%)` }}
      />
      <span className="text-[10px] text-gray-400 w-12 text-right shrink-0 tabular-nums">
        {value > 0 && min < 0 ? "+" : ""}{value}{unit ?? ""}
      </span>
    </div>
  );
}

function FxPanel({
  lane, fx, processing, hasOriginal, hasBeat, detectingKey, onClose, onFxChange, onApplyAutotune, onRevertAutotune, onDetectKey,
}: {
  lane: Lane;
  fx: LaneFx;
  processing: boolean;
  hasOriginal: boolean;
  hasBeat: boolean;
  detectingKey: boolean;
  onClose: () => void;
  onFxChange: (updater: (fx: LaneFx) => LaneFx, rebuild?: boolean) => void;
  onApplyAutotune: () => void;
  onRevertAutotune: () => void;
  onDetectKey: () => void;
}) {
  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 z-50 w-72 bg-[#1a1a1a] border-l border-[#2a2a2a] flex flex-col shadow-2xl overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] shrink-0 sticky top-0 bg-[#1a1a1a] z-10">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-bold text-white">{lane.name} FX</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 p-4 space-y-5">

          {/* ── EQ ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-3 rounded-full bg-violet-500" />
              <span className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">EQ</span>
            </div>
            <div className="space-y-2.5">
              <FxSlider
                label="Low" value={fx.eq.low} min={-12} max={12} step={0.5} unit=" dB"
                onChange={(v) => onFxChange((f) => ({ ...f, eq: { ...f.eq, low: v } }))}
              />
              <FxSlider
                label="Mid" value={fx.eq.mid} min={-12} max={12} step={0.5} unit=" dB"
                onChange={(v) => onFxChange((f) => ({ ...f, eq: { ...f.eq, mid: v } }))}
              />
              <FxSlider
                label="High" value={fx.eq.high} min={-12} max={12} step={0.5} unit=" dB"
                onChange={(v) => onFxChange((f) => ({ ...f, eq: { ...f.eq, high: v } }))}
              />
              <button
                onClick={() => onFxChange((f) => ({ ...f, eq: { low: 0, mid: 0, high: 0 } }))}
                className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >Reset EQ</button>
            </div>
          </section>

          <div className="border-t border-[#252525]" />

          {/* ── Compression ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 rounded-full bg-blue-500" />
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">Compression</span>
              </div>
              <button
                onClick={() => onFxChange((f) => ({ ...f, comp: { ...f.comp, enabled: !f.comp.enabled } }), true)}
                className={`w-9 h-5 rounded-full transition-colors relative ${fx.comp.enabled ? "bg-blue-600" : "bg-[#333]"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow ${fx.comp.enabled ? "left-4.5 left-[18px]" : "left-0.5"}`} />
              </button>
            </div>
            <div className={`space-y-2.5 transition-opacity ${fx.comp.enabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
              <FxSlider
                label="Thresh" value={fx.comp.threshold} min={-48} max={0} step={1} unit=" dB"
                onChange={(v) => onFxChange((f) => ({ ...f, comp: { ...f.comp, threshold: v } }))}
              />
              <FxSlider
                label="Ratio" value={fx.comp.ratio} min={1} max={20} step={0.5} unit=":1"
                onChange={(v) => onFxChange((f) => ({ ...f, comp: { ...f.comp, ratio: v } }))}
              />
            </div>
          </section>

          <div className="border-t border-[#252525]" />

          {/* ── Autotune ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 rounded-full bg-green-500" />
                <span className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">Autotune</span>
              </div>
              <button
                onClick={() => onFxChange((f) => ({ ...f, autotune: { ...f.autotune, enabled: !f.autotune.enabled } }))}
                className={`w-9 h-5 rounded-full transition-colors relative ${fx.autotune.enabled ? "bg-green-600" : "bg-[#333]"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow ${fx.autotune.enabled ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </div>

            <div className={`space-y-3 transition-opacity ${fx.autotune.enabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
              <FxSlider
                label="Amount" value={fx.autotune.amount} min={0} max={100} step={1} unit="%"
                onChange={(v) => onFxChange((f) => ({ ...f, autotune: { ...f.autotune, amount: v } }))}
              />
              {/* Key: two selects — root note + mode */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 w-10 shrink-0">Key</span>
                <div className="flex-1 flex gap-1.5">
                  <select
                    value={fx.autotune.key === "Chromatic" ? "Chromatic" : fx.autotune.key.split(" ")[0]}
                    onChange={(e) => {
                      const root = e.target.value;
                      if (root === "Chromatic") {
                        onFxChange((f) => ({ ...f, autotune: { ...f.autotune, key: "Chromatic" } }));
                      } else {
                        const mode = fx.autotune.key === "Chromatic" ? "Major" : (fx.autotune.key.split(" ")[1] ?? "Major");
                        onFxChange((f) => ({ ...f, autotune: { ...f.autotune, key: `${root} ${mode}` } }));
                      }
                    }}
                    className="flex-1 h-7 px-2 bg-[#111] border border-[#333] rounded-lg text-[11px] text-white focus:outline-none focus:border-violet-500/50 cursor-pointer"
                  >
                    <option value="Chromatic">Chromatic</option>
                    {NOTE_ROOTS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select
                    value={fx.autotune.key === "Chromatic" ? "Major" : (fx.autotune.key.split(" ")[1] ?? "Major")}
                    disabled={fx.autotune.key === "Chromatic"}
                    onChange={(e) => {
                      const root = fx.autotune.key.split(" ")[0];
                      onFxChange((f) => ({ ...f, autotune: { ...f.autotune, key: `${root} ${e.target.value}` } }));
                    }}
                    className="w-16 h-7 px-1 bg-[#111] border border-[#333] rounded-lg text-[11px] text-white focus:outline-none focus:border-violet-500/50 cursor-pointer disabled:opacity-40"
                  >
                    <option value="Major">Major</option>
                    <option value="Minor">Minor</option>
                  </select>
                </div>
              </div>
              {/* Detect Key from beat */}
              <button
                onClick={onDetectKey}
                disabled={detectingKey || !hasBeat}
                title={!hasBeat ? "Load a beat first" : "Analyse the beat audio to detect its key"}
                className="w-full flex items-center justify-center gap-1.5 h-7 rounded-lg border border-violet-500/30 hover:border-violet-500/60 bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 text-[10px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {detectingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                {detectingKey ? "Detecting…" : "Detect Key from Beat"}
              </button>

              {!lane.blobUrl ? (
                <p className="text-[10px] text-gray-600 italic">Record a vocal first to apply autotune.</p>
              ) : (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={onApplyAutotune}
                    disabled={processing}
                    className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-[11px] font-bold transition-colors"
                  >
                    {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    {processing ? "Processing…" : "Apply to Recording"}
                  </button>
                  {hasOriginal && (
                    <button
                      onClick={onRevertAutotune}
                      className="flex items-center justify-center gap-1 h-8 px-2.5 rounded-lg border border-[#333] hover:border-[#555] text-gray-500 hover:text-white text-[11px] transition-colors"
                      title="Revert to original"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-[9px] text-gray-700 leading-relaxed">
                Detects the dominant pitch and snaps it to the nearest note in the selected key.
                Use Amount to control correction strength. Slight changes to tempo may occur.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

// ── Projects Panel ────────────────────────────────────────────────────────────
function ProjectsPanel({
  projects, loading, deletingId, loadingId, onClose, onLoad, onDelete,
}: {
  projects: SavedProject[];
  loading: boolean;
  deletingId: number | null;
  loadingId: number | null;
  onClose: () => void;
  onLoad: (p: SavedProject) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-40 bg-black/50" onClick={onClose} />
      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 z-50 w-80 bg-[#1a1a1a] border-l border-[#2a2a2a] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-bold text-white">Saved Projects</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-gray-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600 text-sm">
              <CloudUpload className="w-8 h-8 text-gray-700" />
              <p>No saved projects yet.</p>
              <p className="text-xs">Record something and hit Save.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#222]">
              {projects.map((proj) => {
                const recordedCount = proj.lanes.filter((l) => l.objectPath).length;
                return (
                  <div key={proj.id} className="px-4 py-3 hover:bg-white/5 transition-colors group">
                    <div className="flex items-start gap-3">
                      <img src={proj.beatThumbnailUrl} className="w-10 h-10 rounded-lg object-cover shrink-0 border border-[#333]" alt="" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white truncate">{proj.name}</p>
                        <p className="text-[10px] text-gray-500 truncate">{proj.beatChannelName}</p>
                        <p className="text-[10px] text-gray-700 mt-0.5">
                          {recordedCount} vocal track{recordedCount !== 1 ? "s" : ""} · {fmtDate(proj.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={() => onLoad(proj)}
                        disabled={loadingId === proj.id}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                      >
                        {loadingId === proj.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderOpen className="w-3 h-3" />}
                        {loadingId === proj.id ? "Loading…" : "Open"}
                      </button>
                      <button
                        onClick={() => onDelete(proj.id)}
                        disabled={deletingId === proj.id}
                        className="w-8 flex items-center justify-center rounded-lg border border-[#2a2a2a] hover:bg-red-900/30 hover:border-red-600/40 text-gray-600 hover:text-red-400 disabled:opacity-50 transition-colors"
                      >
                        {deletingId === proj.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
