import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "./logger";

// ── Binaries ──────────────────────────────────────────────────────────────────
export const YTDLP_BIN =
  process.env.YTDLP_PATH ??
  path.resolve(__dirname, "../../../.pythonlibs/bin/yt-dlp");

export const YTDLP_CACHE_DIR =
  process.env.YTDLP_CACHE_DIR ??
  path.resolve(__dirname, "../../../.ytdlp-cache");

// ── ffmpeg ────────────────────────────────────────────────────────────────────
function resolveFfmpegDir(): string {
  if (process.env.FFMPEG_PATH) return path.dirname(process.env.FFMPEG_PATH);
  const candidates = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.dirname(c);
  }
  try {
    const { execSync } = require("child_process");
    const bin = execSync("which ffmpeg", { encoding: "utf8" }).trim();
    if (bin) return path.dirname(bin);
  } catch {}
  return "";
}
export const FFMPEG_DIR = resolveFfmpegDir();
export const ffmpegArgs = (): string[] =>
  FFMPEG_DIR ? ["--ffmpeg-location", FFMPEG_DIR] : [];

// ── Authentication ────────────────────────────────────────────────────────────
// YouTube requires browser cookies for server-side yt-dlp downloads.
// OAuth2 was removed by YouTube in early 2025 — cookies are the only method.
//
// Priority:
//  1. YTDLP_COOKIES_PATH env var (explicit file path)
//  2. YTDLP_COOKIES secret (raw Netscape cookies.txt content) → written to /tmp
//  3. youtube-cookies.txt in workspace root (dev convenience)

let _cookiePath: string | null = null;
let _resolved = false;

function resolveCookiePath(): string | null {
  if (_resolved) return _cookiePath;
  _resolved = true;

  if (process.env.YTDLP_COOKIES_PATH) {
    if (fs.existsSync(process.env.YTDLP_COOKIES_PATH)) {
      _cookiePath = process.env.YTDLP_COOKIES_PATH;
      logger.info("YouTube cookies loaded from YTDLP_COOKIES_PATH");
      return _cookiePath;
    }
  }

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

  const devFile = path.resolve(__dirname, "../../../youtube-cookies.txt");
  if (fs.existsSync(devFile)) {
    _cookiePath = devFile;
    logger.info("YouTube cookies loaded from dev file");
    return _cookiePath;
  }

  logger.warn(
    "No YouTube cookies found — set the YTDLP_COOKIES secret to enable beat/audio downloads"
  );
  return null;
}

/** Returns yt-dlp auth args to append to every download command. */
export function authArgs(): string[] {
  const p = resolveCookiePath();
  if (!_logged) {
    _logged = true;
    const envLen = process.env.YTDLP_COOKIES?.length ?? 0;
    console.error(`[YTDLP] first auth call: cookiePath=${p ?? "NONE"} YTDLP_COOKIES_env_len=${envLen}`);
  }
  return p ? ["--cookies", p] : [];
}
let _logged = false;

// Alias for backwards compatibility
export const cookieArgs = authArgs;

/**
 * Extra yt-dlp args applied to every YouTube download.
 *
 * player_js_variant=tv — forces the TV player JavaScript for n-challenge solving.
 *
 * --impersonate chrome — curl_cffi TLS fingerprint (helps on some IPs).
 *
 * --proxy — when YTDLP_PROXY is set, routes all yt-dlp traffic through that
 * proxy URL (e.g. socks5://user:pass@host:port or http://user:pass@host:port).
 * This is the primary fix for Replit production IP blocks: YouTube blocks
 * known datacenter IP ranges regardless of cookies; a residential or shared
 * proxy from a different range bypasses this entirely.
 *
 * Get a free shared proxy at https://webshare.io (10 free proxies, no card).
 * Set the YTDLP_PROXY secret to the proxy URL shown in your Webshare dashboard.
 */
export function serverArgs(): string[] {
  const args: string[] = [
    "--extractor-args", "youtube:player_js_variant=tv",
    "--impersonate", "chrome",
  ];

  const proxy = process.env.YTDLP_PROXY?.trim();
  if (proxy) {
    args.push("--proxy", proxy);
    logger.info({ proxy: proxy.replace(/:[^:@]+@/, ":***@") }, "yt-dlp using proxy");
  } else {
    logger.warn("YTDLP_PROXY not set — downloads may fail on production IPs");
  }

  return args;
}

