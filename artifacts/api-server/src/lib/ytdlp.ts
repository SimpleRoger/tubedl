import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "./logger";

// ── Binaries ──────────────────────────────────────────────────────────────────
// In production, pip installs yt-dlp to .pythonlibs/bin at server startup
// (see index.ts ensurePythonDeps). The constant is just a string — the file
// doesn't have to exist at module-load time, only when a download is spawned.
function resolveYtdlpBin(): string {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;

  const candidates = [
    // Replit pip target (dev + production)
    path.resolve(__dirname, "../../../.pythonlibs/bin/yt-dlp"),
    // pip install --user
    "/home/runner/.local/bin/yt-dlp",
    // system pip
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Let the shell resolve it via PATH as a last resort
  return "yt-dlp";
}

// Lazy getter — called at spawn time (inside route handlers), not at module
// load time. This means pip can install yt-dlp in the startup IIFE and set
// YTDLP_PATH before any download is actually attempted.
export function getYtdlpBin(): string {
  // Prefer the env var set by the startup installer
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  return resolveYtdlpBin();
}

// Keep YTDLP_BIN as a named re-export for backward compat (resolves at import
// time so may be "yt-dlp" on fresh production containers — use getYtdlpBin()
// in all spawn calls instead).
export const YTDLP_BIN = resolveYtdlpBin();

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
 * YTDLP_PROXY_LIST — comma-separated list of proxy URLs to rotate through.
 * Each entry: http://user:pass@host:port  or  socks5://user:pass@host:port
 * A random proxy is chosen per download for load distribution. If one IP gets
 * flagged, subsequent downloads automatically use a different one.
 *
 * YTDLP_PROXY — single proxy fallback if YTDLP_PROXY_LIST is not set.
 */

function pickProxy(): string | null {
  const list = process.env.YTDLP_PROXY_LIST?.trim();
  if (list) {
    const proxies = list.split(",").map(p => p.trim()).filter(Boolean);
    if (proxies.length) {
      return proxies[Math.floor(Math.random() * proxies.length)];
    }
  }
  return process.env.YTDLP_PROXY?.trim() ?? null;
}

export function serverArgs(): string[] {
  const args: string[] = [
    "--extractor-args", "youtube:player_js_variant=tv",
    "--impersonate", "chrome",
  ];

  const proxy = pickProxy();
  if (proxy) {
    args.push("--proxy", proxy);
    logger.info({ proxy: proxy.replace(/:[^:@]+@/, ":***@") }, "yt-dlp using proxy");
  } else {
    logger.warn("YTDLP_PROXY_LIST not set — downloads may fail on production IPs");
  }

  return args;
}

