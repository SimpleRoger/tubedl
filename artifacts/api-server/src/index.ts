import { execFileSync, execSync } from "child_process";

// ── Install Python deps BEFORE importing app code ─────────────────────────────
// Static ESM imports are hoisted and run before module body code, so we use
// console.log here (logger is not imported yet) and set process.env.YTDLP_PATH
// so that getYtdlpBin() — which is called lazily inside route handlers — can
// find the correct binary path even on fresh production containers.
//
// In production, .pythonlibs is NOT tracked in git.  We pip-install yt-dlp +
// curl_cffi at startup so they exist before any download request arrives.
(function ensurePythonDeps() {
  const packages = ["yt-dlp==2026.03.17", "curl_cffi==0.13.0"];

  let installed = false;
  for (const pip of ["pip", "pip3"]) {
    try {
      execFileSync(pip, ["install", "--quiet", ...packages], {
        stdio: "pipe",
        timeout: 120_000,
      });
      installed = true;
      console.log("[startup] yt-dlp 2026.03.17 + curl_cffi 0.13.0 installed");
      break;
    } catch {
      // try next pip variant
    }
  }

  if (!installed) {
    console.warn("[startup] pip install skipped — pip/pip3 unavailable");
  }

  // Discover the installed yt-dlp binary and cache it in YTDLP_PATH so
  // getYtdlpBin() returns the right path on the very first request.
  if (!process.env["YTDLP_PATH"]) {
    const candidates = [
      // Replit pip target (dev + production container)
      "/home/runner/workspace/.pythonlibs/bin/yt-dlp",
      "/home/runner/.local/bin/yt-dlp",
      "/usr/local/bin/yt-dlp",
      "/usr/bin/yt-dlp",
    ];
    const { existsSync } = require("fs") as typeof import("fs");
    let found: string | null = null;
    for (const c of candidates) {
      if (existsSync(c)) { found = c; break; }
    }
    if (!found) {
      try {
        // Ask Python where it keeps its scripts (most reliable cross-platform)
        const pyBin = execSync(
          "python3 -c \"import sys, os; print(os.path.join(os.path.dirname(sys.executable), 'yt-dlp'))\"",
          { encoding: "utf8", timeout: 10_000 }
        ).trim();
        if (pyBin && existsSync(pyBin)) found = pyBin;
      } catch {}
    }
    if (found) {
      process.env["YTDLP_PATH"] = found;
      console.log(`[startup] YTDLP_PATH set to ${found}`);
    } else {
      console.warn("[startup] yt-dlp binary not found in known paths — will rely on PATH");
    }
  }
})();

// ── App (imported AFTER env setup above) ─────────────────────────────────────
// NOTE: ESM hoists static imports, so the IIFE above actually runs before any
// route handler is invoked — just not before the module graph is loaded.
// getYtdlpBin() is lazy (called at request time), so YTDLP_PATH is always set
// by the time a download is attempted.
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
