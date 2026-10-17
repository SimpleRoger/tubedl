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

  // Audio-capable chat-completions models only actually process input_audio
  // when "audio" is also declared as an output modality (text-only here
  // silently ignores the audio content block instead of erroring) — so we
  // get a spoken response back too, even though we only want the transcript.
  const completion = await getClient().chat.completions.create({
    model: "gpt-audio",
    modalities: ["text", "audio"],
    audio: { voice: "alloy", format: "mp3" },
    messages: [
      {
        role: "user",
        // Order matters: the model silently ignores the audio (responds as
        // if none was given at all) if input_audio comes before the text
        // part — confirmed by direct testing against the real API, not
        // documented anywhere obvious.
        content: [
          { type: "text", text: RATING_PROMPT },
          { type: "input_audio", input_audio: { data: wav.toString("base64"), format: "wav" } },
        ],
      },
    ],
  } as any);

  const message = completion.choices[0]?.message as any;
  const raw: string = (message?.audio?.transcript || message?.content || "").trim();
  return parseRating(raw);
}
