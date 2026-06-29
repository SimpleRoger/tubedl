import { useState, useRef, useCallback } from "react";
import { customFetch, getApiUrl } from "@workspace/api-client-react";

export type DlStatus = "idle" | "running" | "done" | "error";
export type DlFormat = "mp4" | "mp3";

export interface DlState {
  status: DlStatus;
  pct: number;
  message: string;
  fileId?: string;
  filename?: string;
  error?: string;
  format?: DlFormat;
}

const POLL_MS = 1500;

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  return customFetch<T>(url, opts);
}

function triggerBrowserDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
}

export function useVideoDownload() {
  const [state, setState] = useState<DlState>({ status: "idle", pct: 0, message: "" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const start = useCallback(async (
    videoId: string,
    title: string,
    format: DlFormat = "mp4",
    startTime?: string,
    endTime?: string,
  ) => {
    stopPoll();
    const isClip = Boolean(startTime || endTime);
    setState({
      status: "running", pct: 0, format,
      message: isClip
        ? `Preparing clip ${startTime ?? "0:00"}–${endTime ?? "end"}…`
        : `Starting ${format.toUpperCase()} download…`,
    });

    let jobId: string;
    try {
      const { jobId: id } = await fetchJson<{ jobId: string }>(`/api/video-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, title, format, startTime, endTime }),
      });
      jobId = id;
    } catch (e: any) {
      setState({ status: "error", pct: 0, message: "", error: e.message });
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const data = await fetchJson<DlState & { status: DlStatus }>(`/api/video-download/job/${jobId}`);
        if (data.status === "done" || data.status === "error") {
          stopPoll();
          setState({
            status: data.status,
            pct: data.pct,
            message: data.message,
            fileId: data.fileId,
            filename: data.filename,
            error: data.error,
            format,
          });
          if (data.status === "done" && data.fileId && data.filename) {
            const url = getApiUrl(`/api/video-download/file/${data.fileId}`);
            triggerBrowserDownload(url, data.filename);
          }
        } else {
          setState({
            status: data.status,
            pct: data.pct,
            message: data.message,
            fileId: data.fileId,
            filename: data.filename,
            error: data.error,
            format,
          });
        }
      } catch {
        /* ignore transient poll errors */
      }
    }, POLL_MS);
  }, []);

  const reset = useCallback(() => {
    stopPoll();
    setState({ status: "idle", pct: 0, message: "" });
  }, []);

  const downloadUrl = state.fileId ? getApiUrl(`/api/video-download/file/${state.fileId}`) : null;

  return { state, start, reset, downloadUrl };
}
