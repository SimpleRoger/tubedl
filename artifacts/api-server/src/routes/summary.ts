import { Router, type IRouter } from "express";
import { GetVideoSummaryBody } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// ── Transcript fetching ──────────────────────────────────────────────────────

function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseTranscriptXml(xml: string): string {
  const texts: string[] = [];

  // Newer timedtext format: <p t="..." d="..."><s>word</s></p>
  const pTagRe = /<p\s[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = pTagRe.exec(xml)) !== null) {
    const inner = m[1];
    const sTagRe = /<s[^>]*>([^<]*)<\/s>/g;
    let s: RegExpExecArray | null;
    let word = "";
    while ((s = sTagRe.exec(inner)) !== null) word += s[1];
    if (!word) word = inner.replace(/<[^>]+>/g, "");
    const decoded = decodeHtmlEntities(word).trim();
    if (decoded) texts.push(decoded);
  }

  // Older timedtext format: <text start="..." dur="...">...</text>
  if (texts.length === 0) {
    const textTagRe = /<text\s[^>]*>([^<]*)<\/text>/g;
    while ((m = textTagRe.exec(xml)) !== null) {
      const decoded = decodeHtmlEntities(m[1]).trim();
      if (decoded) texts.push(decoded);
    }
  }

  return texts.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  try {
    // 1. Hit YouTube's InnerTube API to get caption track list
    const playerResp = await fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
        },
        body: JSON.stringify({
          context: {
            client: { clientName: "ANDROID", clientVersion: "20.10.38" },
          },
          videoId,
        }),
      }
    );

    if (!playerResp.ok) return null;

    const playerData = (await playerResp.json()) as Record<string, any>;
    const tracks: any[] | undefined =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!Array.isArray(tracks) || tracks.length === 0) return null;

    // Prefer English, fall back to first available
    const track =
      tracks.find((t) => t.languageCode === "en") ??
      tracks.find((t) => String(t.languageCode).startsWith("en")) ??
      tracks[0];

    const captionUrl: string | undefined = track?.baseUrl;
    if (!captionUrl) return null;

    // 2. Fetch the caption XML
    const captResp = await fetch(captionUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!captResp.ok) return null;

    const xml = await captResp.text();
    const text = parseTranscriptXml(xml);

    return text.length > 50 ? text : null;
  } catch {
    return null;
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

router.post("/videos/summary", async (req, res): Promise<void> => {
  const parsed = GetVideoSummaryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { videoId, title, description, channelName } = parsed.data;

  const transcript = await fetchTranscript(videoId);
  const transcriptUsed = transcript !== null;
  const sourceLabel = transcriptUsed ? "FULL TRANSCRIPT" : "DESCRIPTION";

  // Transcripts can be very long — take up to ~14 000 chars
  const sourceText = transcriptUsed
    ? transcript!.slice(0, 14000)
    : description?.slice(0, 6000) ?? "(no content available)";

  const truncationNote =
    transcriptUsed && transcript!.length > 14000
      ? `\n(Note: transcript truncated at 14 000 of ${transcript!.length} chars)`
      : "";

  const prompt = `You are an expert content analyst. Produce an extremely thorough breakdown of this YouTube video so the reader gains its full value without watching.

VIDEO TITLE: "${title}"
CHANNEL: "${channelName}"
SOURCE: ${sourceLabel}${truncationNote}

${sourceLabel}:
${sourceText}

---

Return a single JSON object — raw JSON only, no markdown, no code fences:

{
  "tldr": "One punchy, specific sentence capturing the whole video.",
  "overview": "5–7 sentences: subject matter, overall argument or story, approach taken, key conclusion, and why it matters.",
  "topicsCovered": [
    {
      "topic": "Concise topic title",
      "detail": "4–6 sentences of the actual content discussed: specific facts, figures, techniques, arguments, demos, code, or examples. Never say 'this is covered' — write what was actually said or shown."
    }
  ],
  "keyTakeaways": [
    "Specific, standalone insight — include actual facts, numbers, steps, or advice. No filler."
  ],
  "notableDetails": [
    "A specific quote, statistic, surprising fact, demo result, or memorable tip."
  ],
  "audience": "Who benefits most, what prior knowledge helps, and what they will concretely gain.",
  "verdict": "3 sentences: what the video does exceptionally well, any gaps or weaknesses, and a clear recommendation."
}

Rules:
- topicsCovered: 6–12 items covering every significant section. Each detail must convey the actual information, not just name the topic.
- keyTakeaways: 7–12 items, specific enough to be useful standalone.
- notableDetails: 4–7 items — the most memorable specifics a viewer would highlight.
- Output raw JSON only.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_completion_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";

  type Parsed = {
    tldr?: string;
    overview?: string;
    topicsCovered?: { topic: string; detail: string }[];
    keyTakeaways?: string[];
    notableDetails?: string[];
    audience?: string;
    verdict?: string;
  };

  let data: Parsed = {};
  try {
    data = JSON.parse(raw) as Parsed;
  } catch {
    res.json({ summary: raw, transcriptUsed });
    return;
  }

  res.json({
    summary: data.overview ?? data.tldr ?? "",
    transcriptUsed,
    structured: {
      tldr: data.tldr ?? "",
      overview: data.overview ?? "",
      topicsCovered: Array.isArray(data.topicsCovered) ? data.topicsCovered : [],
      keyTakeaways: Array.isArray(data.keyTakeaways) ? data.keyTakeaways : [],
      notableDetails: Array.isArray(data.notableDetails) ? data.notableDetails : [],
      audience: data.audience ?? "",
      verdict: data.verdict ?? "",
    },
  });
});

export default router;
