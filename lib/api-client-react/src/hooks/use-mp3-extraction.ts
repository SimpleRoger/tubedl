import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "../custom-fetch";
import { getListSavedVideosQueryKey } from "../generated/api";

interface Mp3JobStatus {
  status: "running" | "done" | "error";
  message: string;
  pct: number;
  error?: string;
}

export type Mp3ExtractionState =
  | { status: "running"; message: string; pct: number }
  | { status: "error"; error: string };

const POLL_INTERVAL_MS = 1500;

/**
 * Triggers and tracks mp3 extraction for saved videos. Not generated from
 * the OpenAPI spec since these job/polling endpoints aren't documented
 * there — hand-rolled against the routes in saved.ts.
 */
export function useMp3Extraction() {
  const queryClient = useQueryClient();
  const [extracting, setExtracting] = useState<Record<string, Mp3ExtractionState>>({});
  const pollTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: getListSavedVideosQueryKey() }),
    [queryClient],
  );

  const pollJob = useCallback(
    (videoId: string, jobId: string) => {
      pollTimers.current[videoId] = setTimeout(async () => {
        try {
          const job = await customFetch<Mp3JobStatus>(`/api/saved/${videoId}/mp3/job/${jobId}`);
          if (job.status === "done") {
            setExtracting((prev) => {
              const { [videoId]: _removed, ...rest } = prev;
              return rest;
            });
            invalidate();
            return;
          }
          if (job.status === "error") {
            setExtracting((prev) => ({
              ...prev,
              [videoId]: { status: "error", error: job.error ?? "Extraction failed" },
            }));
            return;
          }
          setExtracting((prev) => ({
            ...prev,
            [videoId]: { status: "running", message: job.message, pct: job.pct },
          }));
          pollJob(videoId, jobId);
        } catch (err: any) {
          setExtracting((prev) => ({
            ...prev,
            [videoId]: { status: "error", error: err.message ?? "Extraction failed" },
          }));
        }
      }, POLL_INTERVAL_MS);
    },
    [invalidate],
  );

  const extractMp3 = useCallback(
    async (videoId: string) => {
      setExtracting((prev) => ({
        ...prev,
        [videoId]: { status: "running", message: "Starting…", pct: 0 },
      }));
      try {
        const res = await customFetch<{ cached?: boolean; jobId?: string }>(
          `/api/saved/${videoId}/mp3`,
          { method: "POST" },
        );
        if (res.cached) {
          setExtracting((prev) => {
            const { [videoId]: _removed, ...rest } = prev;
            return rest;
          });
          invalidate();
          return;
        }
        if (res.jobId) {
          pollJob(videoId, res.jobId);
        }
      } catch (err: any) {
        setExtracting((prev) => ({
          ...prev,
          [videoId]: { status: "error", error: err.message ?? "Failed to start extraction" },
        }));
      }
    },
    [invalidate, pollJob],
  );

  return { extracting, extractMp3 };
}
