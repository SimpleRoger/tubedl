import { logger } from "./logger";

const BASE_URL = "https://tunelio.dev";

export function tunelioEnabled(): boolean {
  return Boolean(process.env.TUNELIO_API_KEY);
}

interface TunelioCreateResponse {
  url: string;
  filename: string;
  quality: string;
  mode: "video" | "audio";
  expires: number;
  file_size: number;
  file_size_str: string;
  status: string;
}

interface TunelioErrorResponse {
  error: string;
  message: string;
}

/**
 * Fallback for when yt-dlp hits YouTube's bot-check wall. Costs real credits
 * (16/download: 10 for /create — /info isn't needed since we already know
 * the quality we want), so only call this after yt-dlp has actually failed,
 * not as the default path.
 */
export async function tunelioCreate(
  url: string,
  quality: string,
): Promise<TunelioCreateResponse | null> {
  const apiKey = process.env.TUNELIO_API_KEY;
  if (!apiKey) return null;

  try {
    const resp = await fetch(
      `${BASE_URL}/create?${new URLSearchParams({ url, quality })}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30_000) },
    );

    if (!resp.ok) {
      const body = (await resp.json().catch(() => null)) as TunelioErrorResponse | null;
      logger.warn({ status: resp.status, body }, "Tunelio /create failed");
      return null;
    }

    const data = (await resp.json()) as TunelioCreateResponse;
    if (data.status !== "ok") {
      logger.warn({ data }, "Tunelio /create returned non-ok status");
      return null;
    }
    return data;
  } catch (err) {
    logger.warn({ err }, "Tunelio /create request failed");
    return null;
  }
}

/** Downloads the signed /tunnel URL from tunelioCreate() to a local file. */
export async function downloadTunnelUrl(tunnelUrl: string, destPath: string): Promise<boolean> {
  try {
    const resp = await fetch(tunnelUrl, { signal: AbortSignal.timeout(180_000) });
    if (!resp.ok || !resp.body) return false;

    const fs = await import("fs");
    const { Readable } = await import("stream");
    const { pipeline } = await import("stream/promises");
    await pipeline(Readable.fromWeb(resp.body as any), fs.createWriteStream(destPath));
    return true;
  } catch (err) {
    logger.warn({ err }, "Tunelio tunnel download failed");
    return false;
  }
}
