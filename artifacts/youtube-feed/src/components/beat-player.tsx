import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, ChevronDown, ChevronUp, ExternalLink, Music2,
  Sparkles, Loader2, FileText, Download, CheckCircle2,
  Mic, Square, Trash2, Cloud, CloudOff, ChevronsUpDown,
} from "lucide-react";
import type { Video } from "@workspace/api-client-react";
import { formatDuration } from "../lib/utils";
import { useSimilarBeats } from "../hooks/use-beats";
import { useUploadRecording } from "../hooks/use-recordings";
import { BeatCard } from "./beat-card";

const LYRICS_KEY = (videoId: string) => `tubefeed-lyrics-${videoId}`;
const BEAT_META_KEY = (videoId: string) => `tubefeed-beat-meta-${videoId}`;

interface BeatPlayerProps {
  beat: Video | null;
  onClose: () => void;
  onBeatSelect: (beat: Video) => void;
}

type DownloadState = "idle" | "downloading" | "done";
type RecordState = "idle" | "requesting" | "recording" | "done";
type CloudSaveState = "idle" | "uploading" | "saved" | "error";

function formatSeconds(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

export function BeatPlayer({ beat, onClose, onBeatSelect }: BeatPlayerProps) {
  const isOpen = beat !== null;
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [lyrics, setLyrics] = useState("");
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");

  // Mic device selection
  const [micDevices, setMicDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");

  // Recording
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordMime, setRecordMime] = useState("audio/webm");
  const [cloudSaveState, setCloudSaveState] = useState<CloudSaveState>("idle");
  const recordingBlobRef = useRef<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lyricsRef = useRef<HTMLTextAreaElement>(null);
  const downloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mic visualizer
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const { data: similarBeats, isLoading: similarLoading } = useSimilarBeats(
    beat?.videoId ?? "",
    beat?.title ?? "",
    isOpen
  );
  const uploadRecording = useUploadRecording();

  const stopVisualizer = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    const canvas = vizCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const vizFrameCount = useRef(0);

  // Enumerate audio input devices — labels only available after mic permission
  const enumMics = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
        }));
      setMicDevices(inputs);
      setSelectedMicId((prev) => {
        if (!prev && inputs.length > 0) return inputs[0].deviceId;
        if (prev && !inputs.find((m) => m.deviceId === prev) && inputs.length > 0) return inputs[0].deviceId;
        return prev;
      });
    } catch {
      // enumerateDevices not available — no picker shown
    }
  }, []);

  // Enumerate on mount (labels may be empty before first permission grant)
  useEffect(() => {
    enumMics();
  }, [enumMics]);

  const drawVisualizer = useCallback(() => {
    const canvas = vizCanvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) {
      console.error("[viz] missing:", { canvas: !!canvas, analyser: !!analyser });
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // Time-domain waveform — raw samples 0-255, where 128 = silence
    const tdLen = analyser.fftSize;
    const td = new Uint8Array(tdLen);
    analyser.getByteTimeDomainData(td);

    // Log the first 5 frames so we can see if data flows
    vizFrameCount.current += 1;
    if (vizFrameCount.current <= 5) {
      const acState = audioContextRef.current?.state ?? "no ctx";
      console.error(`[viz] frame ${vizFrameCount.current} | ac=${acState} | td[0..4]=${Array.from(td.slice(0,5)).join(",")} | fftSize=${tdLen}`);
    }

    // Compute peak amplitude (0..1) — non-zero whenever mic has any signal
    let peak = 0;
    for (let i = 0; i < tdLen; i++) {
      const v = Math.abs(td[i] - 128) / 128;
      if (v > peak) peak = v;
    }

    ctx.clearRect(0, 0, W, H);

    // Draw centre line (silence reference)
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    // Draw waveform line (centered: 128 = H/2, peaks fill ±H/2)
    const sliceW = W / tdLen;
    // Colour: green when quiet → yellow → red as loud
    const r = Math.round(Math.min(255, peak * 2 * 255));
    const g = Math.round(Math.max(0, (1 - peak * 1.5) * 220));

    const buildPath = () => {
      ctx.beginPath();
      for (let i = 0; i < tdLen; i++) {
        const y = H / 2 - ((td[i] - 128) / 128) * (H / 2);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceW, y);
      }
    };

    // Glow layer
    if (peak > 0.02) {
      ctx.strokeStyle = `rgba(${r},${g},30,0.2)`;
      ctx.lineWidth = 7;
      buildPath();
      ctx.stroke();
    }

    ctx.strokeStyle = `rgb(${r},${g},30)`;
    ctx.lineWidth = 2;
    buildPath();
    ctx.stroke();

    // Live peak dB readout (right edge) — useful for debugging
    const dbVal = peak > 0 ? Math.round(20 * Math.log10(peak)) : -Infinity;
    const dbText = isFinite(dbVal) ? `${dbVal} dB` : "–∞ dB";
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = peak > 0.05 ? `rgb(${r},${g},30)` : "rgba(255,255,255,0.25)";
    ctx.textAlign = "right";
    ctx.fillText(dbText, W - 4, H - 4);

    animFrameRef.current = requestAnimationFrame(drawVisualizer);
  }, []);

  const resetRecording = useCallback((revokeUrl = true) => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (revokeUrl && recordingUrl) URL.revokeObjectURL(recordingUrl);
    stopVisualizer();
    recordingBlobRef.current = null;
    setRecordingUrl(null);
    setRecordState("idle");
    setRecordSeconds(0);
    setCloudSaveState("idle");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingUrl, stopVisualizer]);

  // Start/stop the visualizer draw loop when recording state changes
  useEffect(() => {
    if (recordState === "recording" && analyserRef.current) {
      // Canvas is now mounted — kick off the animation loop
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      drawVisualizer();
    }
    // When recording stops, stopVisualizer is called inside mr.onstop
  }, [recordState, drawVisualizer]);

  // Reset recording & lyrics when beat changes
  useEffect(() => {
    if (beat) {
      const saved = localStorage.getItem(LYRICS_KEY(beat.videoId)) ?? "";
      setLyrics(saved);
      setVideoExpanded(false);
      resetRecording();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat?.videoId]);

  // Save beat metadata
  useEffect(() => {
    if (!beat) return;
    localStorage.setItem(BEAT_META_KEY(beat.videoId), JSON.stringify({
      videoId: beat.videoId,
      title: beat.title,
      channelName: beat.channelName,
      thumbnailUrl: beat.thumbnailUrl,
    }));
  }, [beat?.videoId]);

  // Debounced lyrics save
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (downloadTimerRef.current) clearTimeout(downloadTimerRef.current);
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSimilarClick = useCallback((similar: Video) => {
    onBeatSelect(similar);
  }, [onBeatSelect]);

  const handleDownload = useCallback(() => {
    if (!beat || downloadState === "downloading") return;
    setDownloadState("downloading");
    const url = `/api/beats/${beat.videoId}/download?title=${encodeURIComponent(beat.title)}`;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${beat.title}.mp3`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    if (downloadTimerRef.current) clearTimeout(downloadTimerRef.current);
    downloadTimerRef.current = setTimeout(() => {
      setDownloadState("done");
      downloadTimerRef.current = setTimeout(() => setDownloadState("idle"), 3000);
    }, 2000);
  }, [beat, downloadState]);

  const startRecording = useCallback(async () => {
    if (recordState !== "idle") return;
    setRecordState("requesting");
    vizFrameCount.current = 0;

    // IMPORTANT: AudioContext must be created synchronously in the click handler.
    // Browsers (Chrome/Safari) reject AudioContext creation after any await because
    // the user-gesture context is lost. We create it here, then connect the mic stream
    // once getUserMedia resolves.
    let ac: AudioContext | null = null;
    try {
      ac = new AudioContext();
      audioContextRef.current = ac;
      // Fire-and-forget resume — don't await so we stay synchronous
      if (ac.state === "suspended") ac.resume().catch(() => {});
    } catch {
      // Visualizer will be skipped, recording still works
    }

    try {
      // Use selected mic if one is chosen, otherwise fall back to default
      const audioConstraints: boolean | MediaTrackConstraints = selectedMicId
        ? { deviceId: { exact: selectedMicId } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      // Re-enumerate now that permission is granted — browser will expose real labels
      enumMics();
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      setRecordMime(mime);
      const mr = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        recordingBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setRecordingUrl(url);
        setRecordState("done");
        stream.getTracks().forEach((t) => t.stop());
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        stopVisualizer();
      };

      // Connect mic stream to the already-created (and running) AudioContext
      if (ac) {
        try {
          // Ensure it's running after the await gap
          if (ac.state === "suspended") await ac.resume();
          const source = ac.createMediaStreamSource(stream);
          const analyser = ac.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.55;
          source.connect(analyser);
          // Silent gain → destination keeps the graph active in all browsers
          const silent = ac.createGain();
          silent.gain.value = 0;
          analyser.connect(silent);
          silent.connect(ac.destination);
          analyserRef.current = analyser;
        } catch (e) {
          console.error("[viz] analyser setup failed:", e);
        }
      }

      mr.start(250);
      setRecordState("recording");
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      if (ac) { ac.close().catch(() => {}); audioContextRef.current = null; }
      setRecordState("idle");
    }
  }, [recordState, stopVisualizer, selectedMicId, enumMics]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
  }, []);

  const handleSaveToCloud = useCallback(async () => {
    if (!beat || !recordingBlobRef.current || cloudSaveState === "uploading") return;
    setCloudSaveState("uploading");
    try {
      await uploadRecording.mutateAsync({
        blob: recordingBlobRef.current,
        mime: recordMime,
        meta: {
          beatVideoId: beat.videoId,
          beatTitle: beat.title,
          beatChannelName: beat.channelName,
          beatThumbnailUrl: beat.thumbnailUrl,
          objectPath: "",
          durationSeconds: recordSeconds,
        },
      });
      setCloudSaveState("saved");
    } catch {
      setCloudSaveState("error");
    }
  }, [beat, recordMime, recordSeconds, cloudSaveState, uploadRecording]);

  const downloadFreestyle = useCallback(() => {
    if (!recordingUrl || !beat) return;
    const ext = recordMime.includes("mp4") ? "m4a" : "webm";
    const anchor = document.createElement("a");
    anchor.href = recordingUrl;
    anchor.download = `${beat.title} - freestyle.${ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, [recordingUrl, beat, recordMime]);

  if (!beat) return null;

  const duration = formatDuration(beat.duration);
  const wordCount = lyrics.trim().split(/\s+/).filter(Boolean).length;
  const lineCount = lyrics.split("\n").length;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/85 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ y: 60, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="relative z-10 w-full max-w-5xl max-h-[94vh] bg-surface border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col lg:flex-row shadow-[0_32px_80px_-16px_rgba(0,0,0,0.7)]"
          >
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

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <button
                        onClick={handleDownload}
                        disabled={downloadState === "downloading"}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all border ${
                          downloadState === "done"
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : downloadState === "downloading"
                            ? "bg-surface text-text-muted border-border cursor-not-allowed"
                            : "bg-surface hover:bg-surface-hover text-text-muted hover:text-text-main border-border hover:border-primary/30"
                        }`}
                      >
                        {downloadState === "downloading" ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" />Preparing…</>
                        ) : downloadState === "done" ? (
                          <><CheckCircle2 className="w-3.5 h-3.5" />Downloaded!</>
                        ) : (
                          <><Download className="w-3.5 h-3.5" />Download MP3</>
                        )}
                      </button>

                      {/* Mic picker + Record button */}
                      {(recordState === "idle" || recordState === "requesting") && (
                        <div className="flex items-center gap-1">
                          {/* Mic device selector — only show when >1 device available */}
                          {micDevices.length > 1 && (
                            <div className="relative">
                              <Mic className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted z-10" />
                              <ChevronsUpDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-text-muted z-10" />
                              <select
                                value={selectedMicId}
                                onChange={(e) => setSelectedMicId(e.target.value)}
                                disabled={recordState === "requesting"}
                                title="Choose microphone"
                                className="appearance-none pl-6 pr-6 py-1 rounded-lg text-xs font-medium bg-surface border border-border text-text-muted hover:border-red-500/30 hover:text-text-main focus:outline-none focus:border-red-500/40 transition-colors cursor-pointer max-w-[140px] truncate disabled:opacity-50"
                              >
                                {micDevices.map((m) => (
                                  <option key={m.deviceId} value={m.deviceId}>{m.label}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          <button
                            onClick={startRecording}
                            disabled={recordState === "requesting"}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border bg-surface hover:bg-red-500/10 text-text-muted hover:text-red-400 border-border hover:border-red-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {recordState === "requesting" ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Waiting…</>
                            ) : (
                              <><Mic className="w-3.5 h-3.5" />Record</>
                            )}
                          </button>
                        </div>
                      )}

                      {recordState === "recording" && (
                        <button
                          onClick={stopRecording}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20 transition-all"
                        >
                          <Square className="w-3 h-3" />
                          Stop
                        </button>
                      )}
                    </div>

                    {/* Live mic visualizer — shows while recording */}
                    <AnimatePresence>
                      {recordState === "recording" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden w-full mt-2"
                        >
                          <div className="w-full p-2.5 rounded-xl bg-red-500/5 border border-red-500/20 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">Recording · {formatSeconds(recordSeconds)}</span>
                              </div>
                              <span className="text-[10px] text-text-muted">Mic input</span>
                            </div>
                            <canvas
                              ref={vizCanvasRef}
                              width={600}
                              height={48}
                              className="w-full rounded-lg"
                              style={{ background: "rgba(0,0,0,0.4)" }}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Recorded playback widget */}
                    <AnimatePresence>
                      {recordState === "done" && recordingUrl && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2.5 p-3 rounded-xl bg-red-500/5 border border-red-500/15 flex flex-col gap-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">
                                Freestyle · {formatSeconds(recordSeconds)}
                              </span>
                            </div>

                            <audio
                              src={recordingUrl}
                              controls
                              className="w-full h-8"
                              style={{ accentColor: "#ef4444" }}
                            />

                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Save to cloud */}
                              <button
                                onClick={handleSaveToCloud}
                                disabled={cloudSaveState === "uploading" || cloudSaveState === "saved"}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${
                                  cloudSaveState === "saved"
                                    ? "bg-green-500/10 text-green-400 border-green-500/20 cursor-default"
                                    : cloudSaveState === "error"
                                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                                    : cloudSaveState === "uploading"
                                    ? "bg-surface text-text-muted border-border cursor-not-allowed"
                                    : "bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20"
                                }`}
                              >
                                {cloudSaveState === "uploading" ? (
                                  <><Loader2 className="w-3 h-3 animate-spin" />Saving…</>
                                ) : cloudSaveState === "saved" ? (
                                  <><CheckCircle2 className="w-3 h-3" />Saved to cloud</>
                                ) : cloudSaveState === "error" ? (
                                  <><CloudOff className="w-3 h-3" />Retry save</>
                                ) : (
                                  <><Cloud className="w-3 h-3" />Save to cloud</>
                                )}
                              </button>

                              {/* Local download */}
                              <button
                                onClick={downloadFreestyle}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-text-muted hover:text-text-main border border-border hover:border-primary/30 transition-all"
                              >
                                <Download className="w-3 h-3" />
                                Download
                              </button>

                              {/* Discard */}
                              <button
                                onClick={() => resetRecording()}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-text-muted hover:text-red-400 border border-border hover:border-red-500/20 transition-all ml-auto"
                              >
                                <Trash2 className="w-3 h-3" />
                                Discard
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
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
