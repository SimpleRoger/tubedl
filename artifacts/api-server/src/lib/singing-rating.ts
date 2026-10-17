import { spawn } from "child_process";
import { writeFile, unlink, readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import OpenAI from "openai";
import { getFfmpegBin } from "./ytdlp";

export function singingRatingEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Lazy — constructed on first real use, not at module load, so this file can
// be imported even when OPENAI_API_KEY isn't set yet (the route just returns
// a clear 503 instead of crashing the whole server on startup).
let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/** Converts any browser-recorded audio (webm/ogg/mp4) to wav via ffmpeg. */
async function convertToWav(buffer: Buffer): Promise<Buffer> {
  const inputPath = join(tmpdir(), `sing-rating-in-${randomUUID()}`);
  const outputPath = join(tmpdir(), `sing-rating-out-${randomUUID()}.wav`);

  try {
    await writeFile(inputPath, buffer);
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(getFfmpegBin() || "ffmpeg", [
        "-i", inputPath,
        "-vn", "-f", "wav", "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le",
        "-y", outputPath,
      ]);
      ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
      ffmpeg.on("error", reject);
    });
    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

export interface SingingRating {
  score: number | null;
  pitch: string;
  feedback: string;
  raw: string;
}

const RATING_PROMPT = `You are an encouraging but honest vocal coach listening to a short clip of
someone singing. Rate their pitch accuracy and control. Respond in EXACTLY
this format, nothing else:

SCORE: <integer 1-10>
PITCH: <one sentence on pitch accuracy and stability>
FEEDBACK: <2-3 encouraging sentences with specific, actionable advice>`;

function parseRating(raw: string): SingingRating {
  const scoreMatch = raw.match(/SCORE:\s*(\d+)/i);
  const pitchMatch = raw.match(/PITCH:\s*(.+?)(?:\n|$)/i);
  const feedbackMatch = raw.match(/FEEDBACK:\s*([\s\S]+)/i);

  return {
    score: scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10))) : null,
    pitch: pitchMatch?.[1]?.trim() ?? "",
    feedback: feedbackMatch?.[1]?.trim() ?? (scoreMatch || pitchMatch ? "" : raw.trim()),
    raw,
  };
}

/** Rates a recorded singing clip. Throws on genuine API/conversion failure — callers decide the HTTP response. */
export async function rateSingingClip(audioBuffer: Buffer): Promise<SingingRating> {
  const wav = await convertToWav(audioBuffer);

  const completion = await getClient().chat.completions.create({
    model: "gpt-audio",
    modalities: ["text"],
    messages: [
      {
        role: "user",
        content: [
          { type: "input_audio", input_audio: { data: wav.toString("base64"), format: "wav" } },
          { type: "text", text: RATING_PROMPT },
        ],
      },
    ],
  } as any);

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  return parseRating(raw);
}
