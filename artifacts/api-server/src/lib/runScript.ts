import { spawn } from "child_process";
import path from "path";
import { getYtdlpBin, cookieArgs, serverArgs } from "./ytdlp";

const PYTHON =
  process.env.PYTHON_PATH ??
  path.resolve(__dirname, "../../../.pythonlibs/bin/python3");

const BOT_PHRASES = ["Sign in", "bot", "confirm your age", "This video is unavailable"];

function isBlockedError(msg: string): boolean {
  return BOT_PHRASES.some((p) => msg.includes(p));
}

function runOnce<T>(scriptPath: string, videoId: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const ytdlp = getYtdlpBin();
    const cookies = cookieArgs();
    const servers = serverArgs();
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

/** Run the script, retrying up to `maxAttempts` times on bot-block errors. */
export async function runScript<T>(
  scriptPath: string,
  videoId: string,
  maxAttempts = 3,
): Promise<T> {
  let lastErr = new Error("Unknown error");
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runOnce<T>(scriptPath, videoId);
    } catch (e) {
      lastErr = e as Error;
      if (attempt < maxAttempts && isBlockedError(lastErr.message)) {
        continue;
      }
      break;
    }
  }
  throw lastErr;
}
