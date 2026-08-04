import type { TranscriptWord } from "../../shared/timeline.js";
import {
  AI_CLIP_TYPES,
  type AiClipType,
  type FindMomentsRequest,
  type MomentCandidate,
  type MomentScore,
  type MomentSegment,
} from "../../shared/ai-edit.js";

const MOMENTS_TOOL = {
  name: "propose_moments",
  description: "Propose candidate short-form video moments cut from a long-form transcript.",
  input_schema: {
    type: "object",
    properties: {
      moments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: AI_CLIP_TYPES },
            title: { type: "string", description: "Short hook-style title for the clip" },
            reasoning: { type: "string", description: "One or two sentences on why this moment works as a clip" },
            transcriptExcerpt: {
              type: "string",
              description: "Exact opening and payoff words from the source transcript, never paraphrased",
            },
            scoreBreakdown: {
              type: "object",
              properties: {
                hook: { type: "number", description: "0-25 opening strength" },
                selfContained: { type: "number", description: "0-25 context independence" },
                payoff: { type: "number", description: "0-25 strength of the resolution or takeaway" },
                cleanCut: { type: "number", description: "0-25 natural start and end boundaries" },
              },
              required: ["hook", "selfContained", "payoff", "cleanCut"],
            },
            segments: {
              type: "array",
              description:
                "One or more source-time ranges to stitch together in order. Use more than one segment when the strongest exchange has a boring or off-topic stretch in the middle that should be cut out.",
              items: {
                type: "object",
                properties: {
                  startSec: { type: "number" },
                  endSec: { type: "number" },
                },
                required: ["startSec", "endSec"],
              },
            },
          },
          required: ["type", "title", "reasoning", "transcriptExcerpt", "scoreBreakdown", "segments"],
        },
      },
    },
    required: ["moments"],
  },
} as const;

function renderTranscript(words: TranscriptWord[]): string {
  const lines: string[] = [];
  let lineWords: string[] = [];
  let lineStart = words[0]?.start ?? 0;

  for (const word of words) {
    if (lineWords.length === 0) lineStart = word.start;
    lineWords.push(word.word);
    if (lineWords.length >= 12) {
      lines.push(`[${lineStart.toFixed(1)}] ${lineWords.join(" ")}`);
      lineWords = [];
    }
  }
  if (lineWords.length) lines.push(`[${lineStart.toFixed(1)}] ${lineWords.join(" ")}`);
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are an expert short-form video editor selecting the most viral-worthy moments from a long-form video transcript, to be cut into vertical TikTok/Reels/Shorts clips.

Ground rules, learned from studying real professionally-edited clips against their raw source footage:
- Prioritize interpersonal tension, conflict, pushback, contrarian claims, or surprising reveals over agreeable or harmonious dialogue. A pleasant, earnest answer is rarely the clip, even if it directly answers the interesting question.
- The strongest exchange is often scattered: real editors frequently cut out a boring or tangential middle section and stitch together two or three short segments from the same general area rather than using one long contiguous window. Do this when it makes the clip tighter and stronger.
- Cut aggressively. A real reference case kept only ~37% of the runtime of an already-selected tense exchange, discarding an entire off-topic tangent in the middle.
- Prefer a cold open: the clip should start on the most interesting fragment of speech, never on throwaway preamble, silence, or a static setup line.
- Target a total combined duration across all segments of roughly 15-60 seconds per moment.
- Give each moment a short, punchy title and a one-to-two sentence reasoning for why it works as a clip.
- Score each candidate out of 25 for hook, self-containment, payoff, and clean-cut quality. Use the score to rank candidates, but keep the candidates meaningfully different from one another.
- transcriptExcerpt must quote exact words that appear in the supplied transcript. Never invent or paraphrase source dialogue.

You will be given a word-timestamped transcript of the full source video, formatted as one line per timestamp: "[seconds] words...". Segment start/end times you propose must fall within the given timestamps and refer to seconds from the start of the video.`;

const TYPE_GUIDANCE: Record<AiClipType, string> = {
  best: "the strongest all-around, social-ready moments",
  "hot-take": "contrarian claims, disagreement, tension, or debate-worthy opinions",
  educational: "clear frameworks, practical advice, explanations, or surprising facts",
  story: "complete miniature stories with setup, rising tension, and payoff",
  hook: "short cold opens or trailer moments that create immediate curiosity",
  product: "product value, proof, demonstrations, transformations, or customer outcomes",
};

export async function findMoments(
  words: TranscriptWord[],
  request: FindMomentsRequest,
): Promise<MomentCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to sidecar/.env and restart the sidecar.");
  }

  const transcript = renderTranscript(words);
  const targetCount = Math.min(request.count, Math.max(1, Math.ceil(words.length / 40)));
  const requestedTypes = request.clipTypes.map((type) => `${type}: ${TYPE_GUIDANCE[type]}`).join("\n");
  const customDirection = request.prompt?.trim()
    ? `\nAdditional direction from the editor: ${request.prompt.trim()}`
    : "";
  const userPrompt = `<transcript>\n${transcript}\n</transcript>

Propose up to ${targetCount} genuine, distinct candidate moments across these requested clip types:
${requestedTypes}

Each candidate must have a combined duration between ${request.minDurationSec} and ${request.maxDurationSec} seconds.
Avoid candidates that repeat the same idea or substantially overlap one another.
If the source cannot support ${targetCount} strong candidates, return fewer. Never create placeholder,
"insufficient content", error-message, or fabricated candidates just to reach the requested count.${customDirection}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [MOMENTS_TOOL],
      tool_choice: { type: "tool", name: "propose_moments" },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    content: { type: string; name?: string; input?: { moments: unknown[] } }[];
  };
  const toolUse = data.content.find((block) => block.type === "tool_use" && block.name === "propose_moments");
  return normalizeMoments(toolUse?.input?.moments ?? [], words, request);
}

// Claude's tool-use output isn't always perfectly schema-conformant in practice
// (segments have shown up as raw [start, end] tuples instead of the requested
// {startSec, endSec} object shape), so normalize defensively rather than trust it.
function normalizeMoments(
  raw: unknown[],
  words: TranscriptWord[],
  request: FindMomentsRequest,
): MomentCandidate[] {
  const moments: MomentCandidate[] = [];
  const sourceStart = words[0]?.start ?? 0;
  const sourceEnd = words[words.length - 1]?.end ?? 0;
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as {
      type?: unknown;
      title?: unknown;
      reasoning?: unknown;
      transcriptExcerpt?: unknown;
      scoreBreakdown?: unknown;
      segments?: unknown;
    };
    if (
      !isAiClipType(candidate.type) ||
      !request.clipTypes.includes(candidate.type) ||
      typeof candidate.title !== "string" ||
      typeof candidate.reasoning !== "string" ||
      typeof candidate.transcriptExcerpt !== "string" ||
      !Array.isArray(candidate.segments)
    ) {
      continue;
    }
    const segments: MomentSegment[] = [];
    for (const rawSegment of candidate.segments) {
      const segment = normalizeSegment(rawSegment, sourceStart, sourceEnd);
      if (segment) segments.push(segment);
    }
    const duration = segments.reduce((sum, segment) => sum + segment.endSec - segment.startSec, 0);
    if (!segments.length || duration < request.minDurationSec - 2 || duration > request.maxDurationSec + 2) continue;
    const scoreBreakdown = normalizeScore(candidate.scoreBreakdown);
    const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
    if (score < 40 || !isGroundedExcerpt(candidate.transcriptExcerpt, words)) continue;
    const normalized: MomentCandidate = {
      id: crypto.randomUUID(),
      type: candidate.type,
      title: candidate.title.trim(),
      reasoning: candidate.reasoning.trim(),
      transcriptExcerpt: candidate.transcriptExcerpt.trim(),
      scoreBreakdown,
      score,
      segments,
    };
    if (moments.some((existing) => overlapRatio(existing.segments, normalized.segments) > 0.7)) continue;
    moments.push(normalized);
  }
  return moments.sort((a, b) => b.score - a.score).slice(0, request.count);
}

function normalizeSegment(rawSegment: unknown, sourceStart: number, sourceEnd: number): MomentSegment | null {
  let startSec: unknown;
  let endSec: unknown;
  if (Array.isArray(rawSegment)) {
    [startSec, endSec] = rawSegment;
  } else if (typeof rawSegment === "object" && rawSegment !== null) {
    ({ startSec, endSec } = rawSegment as { startSec?: unknown; endSec?: unknown });
  }
  if (typeof startSec !== "number" || typeof endSec !== "number") return null;
  const clampedStart = Math.max(sourceStart, Math.min(sourceEnd, startSec));
  const clampedEnd = Math.max(sourceStart, Math.min(sourceEnd, endSec));
  if (!(clampedEnd > clampedStart)) return null;
  return { startSec: clampedStart, endSec: clampedEnd };
}

function isAiClipType(value: unknown): value is AiClipType {
  return typeof value === "string" && AI_CLIP_TYPES.includes(value as AiClipType);
}

function normalizeScore(raw: unknown): MomentScore {
  const value = typeof raw === "object" && raw !== null ? raw as Partial<MomentScore> : {};
  return {
    hook: clampScore(value.hook),
    selfContained: clampScore(value.selfContained),
    payoff: clampScore(value.payoff),
    cleanCut: clampScore(value.cleanCut),
  };
}

function clampScore(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(25, value)))
    : 0;
}

function isGroundedExcerpt(excerpt: string, words: TranscriptWord[]): boolean {
  const excerptTokens = tokenize(excerpt);
  if (excerptTokens.length < 3) return false;
  const sourceTokens = words.flatMap((word) => tokenize(word.word));
  let sourceIndex = 0;
  for (const token of excerptTokens) {
    sourceIndex = sourceTokens.indexOf(token, sourceIndex);
    if (sourceIndex === -1) return false;
    sourceIndex += 1;
  }
  return true;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

function overlapRatio(a: MomentSegment[], b: MomentSegment[]): number {
  const aDuration = a.reduce((sum, segment) => sum + segment.endSec - segment.startSec, 0);
  const bDuration = b.reduce((sum, segment) => sum + segment.endSec - segment.startSec, 0);
  const shorter = Math.min(aDuration, bDuration);
  if (shorter <= 0) return 0;
  let overlap = 0;
  for (const left of a) {
    for (const right of b) {
      overlap += Math.max(0, Math.min(left.endSec, right.endSec) - Math.max(left.startSec, right.startSec));
    }
  }
  return overlap / shorter;
}
