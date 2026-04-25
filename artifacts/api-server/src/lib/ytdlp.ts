import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "./logger";

// Resolved at module load time — used by all routes
export const YTDLP_BIN =
  process.env.YTDLP_PATH ??
  path.resolve(__dirname, "../../../.pythonlibs/bin/yt-dlp");

export const YTDLP_CACHE_DIR =
  process.env.YTDLP_CACHE_DIR ??
  path.resolve(__dirname, "../../../.ytdlp-cache");

// Resolve ffmpeg directory (yt-dlp needs a dir, not just a binary name)
function resolveFfmpegDir(): string {
  if (process.env.FFMPEG_PATH) return path.dirname(process.env.FFMPEG_PATH);
  // Try common locations
  const candidates = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.dirname(c);
  }
  // Fall back to PATH lookup via which
  try {
    const { execSync } = require("child_process");
    const bin = execSync("which ffmpeg", { encoding: "utf8" }).trim();
    if (bin) return path.dirname(bin);
  } catch {}
  return "";
}
export const FFMPEG_DIR = resolveFfmpegDir();
export const ffmpegArgs = () =>
  FFMPEG_DIR ? ["--ffmpeg-location", FFMPEG_DIR] : [];

// ── Cookie resolution ─────────────────────────────────────────────────────────
// Priority:
//  1. YTDLP_COOKIES_PATH env var (explicit file path)
//  2. YTDLP_COOKIES env var (raw Netscape cookie content) → written to /tmp
//  3. workspace youtube-cookies.txt (dev convenience file)

let _cookiePath: string | null = null;

export function getCookiePath(): string | null {
  if (_cookiePath !== null) return _cookiePath;

  // 1. Explicit path override
  if (process.env.YTDLP_COOKIES_PATH) {
    _cookiePath = fs.existsSync(process.env.YTDLP_COOKIES_PATH)
      ? process.env.YTDLP_COOKIES_PATH
      : null;
    return _cookiePath;
  }

  // 2. Raw cookie content stored as a secret
  const rawCookies = process.env.YTDLP_COOKIES;
  if (rawCookies && rawCookies.trim().length > 10) {
    const tmpPath = path.join(os.tmpdir(), "tubefeed-yt-cookies.txt");
    try {
      fs.writeFileSync(tmpPath, rawCookies, { mode: 0o600 });
      _cookiePath = tmpPath;
      logger.info({ path: tmpPath }, "YouTube cookies written from YTDLP_COOKIES secret");
      return _cookiePath;
    } catch (e) {
      logger.error({ err: e }, "Failed to write YTDLP_COOKIES to temp file");
    }
  }

  // 3. Dev convenience file
  const devFile = path.resolve(__dirname, "../../../youtube-cookies.txt");
  if (fs.existsSync(devFile)) {
    _cookiePath = devFile;
    return _cookiePath;
  }

  _cookiePath = null;
  logger.warn("No YouTube cookies found — yt-dlp downloads may be blocked by bot detection");
  return null;
}

export function cookieArgs(): string[] {
  const p = getCookiePath();
  return p ? ["--cookies", p] : [];
}
