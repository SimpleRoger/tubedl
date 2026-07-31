import { Router, type IRouter } from "express";
import { execSync } from "child_process";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getYtdlpBin, getFfmpegBin } from "../lib/ytdlp";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Reports whether the environment yt-dlp actually needs is present, without
// triggering a real download. Useful for verifying a deploy after infra
// changes (Deno, PO token provider, ffmpeg) instead of guessing from logs.
router.get("/diagnostics", (_req, res) => {
  function tryRun(cmd: string): { ok: true; output: string } | { ok: false; error: string } {
    try {
      return { ok: true, output: execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim() };
    } catch (e: any) {
      return { ok: false, error: e.message?.split("\n")[0] ?? String(e) };
    }
  }

  res.json({
    deno: tryRun("deno --version"),
    ytdlp: { path: getYtdlpBin(), version: tryRun(`${getYtdlpBin()} --version`) },
    ffmpeg: { path: getFfmpegBin() },
    potProvider: {
      configured: Boolean(process.env.BGUTIL_POT_URL),
      url: process.env.BGUTIL_POT_URL ?? null,
    },
    cookies: {
      hasYtdlpCookiesEnv: Boolean(process.env.YTDLP_COOKIES),
      hasYtdlpCookiesPathEnv: Boolean(process.env.YTDLP_COOKIES_PATH),
    },
  });
});

export default router;
