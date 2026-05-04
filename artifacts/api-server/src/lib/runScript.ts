import { spawn } from "child_process";
import path from "path";
import { getYtdlpBin, cookieArgs, serverArgs } from "./ytdlp";

const PYTHON =
  process.env.PYTHON_PATH ??
  path.resolve(__dirname, "../../../.pythonlibs/bin/python3");

const RETRY_PHRASES = [
  // YouTube bot detection
  "Sign in", "bot", "confirm your age", "This video is unavailable",
  // Proxy failures — pick a different proxy and retry
  "407", "CONNECT tunnel failed", "curl: (56)", "curl: (35)",
  "ProxyError", "tunnel", "response 407",
];

function isRetryableError(msg: string): boolean {
  return RETRY_PHRASES.some((p) => msg.includes(p));
}

function runOnce<T>(scriptPath: string, videoId: string, useProxy = true): Promise<T> {
  return new Promise((resolve, reject) => {
    const ytdlp = getYtdlpBin();
    const cookies = cookieArgs();
    const servers = useProxy ? serverArgs() : [
      "--extractor-args", "youtube:player_client=ios,mweb,tv",
      "--impersonate", "chrome",
    ];
    const args = [scriptPath, videoId, ytdlp, ...cookies, ...servers];
    const child = spawn(PYTHON, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Timed out"));
    }, 90_000);

    child.on("close", () => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString().trim();
      const stderr = Buffer.concat(err).toString().trim();
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) { reject(new Error(parsed.error)); return; }
          resolve(parsed as T);
          return;
        } catch { /* fall through */ }
      }
      reject(new Error(stderr || "Script produced no output"));
    });
  });
}

/** Run the script, retrying up to `maxAttempts` times on retryable errors.
 *  The final attempt always runs without a proxy as a last-resort fallback. */
export async function runScript<T>(
  scriptPath: string,
  videoId: string,
  maxAttempts = 3,
): Promise<T> {
  let lastErr = new Error("Unknown error");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Last attempt: try without proxy in case all proxies are failing
    const useProxy = attempt < maxAttempts;
    try {
      return await runOnce<T>(scriptPath, videoId, useProxy);
    } catch (e) {
      lastErr = e as Error;
      if (attempt < maxAttempts && isRetryableError(lastErr.message)) {
        continue;
      }
      // If the proxied attempt failed for a non-retryable reason, jump to no-proxy attempt
      if (attempt < maxAttempts) {
        attempt = maxAttempts - 1; // will increment to maxAttempts (no-proxy) next
      } else {
        break;
      }
    }
  }
  throw lastErr;
}
