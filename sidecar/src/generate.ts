/** OpenAI-backed generation for faceless content: AI voiceover (TTS) and AI
 * still images (b-roll, product shots, backgrounds). Deliberately thin,
 * fetch-based wrappers -- same posture as transcribe.ts's Whisper call --
 * rather than pulling in the `openai` SDK for two endpoints.
 *
 * Video generation is NOT implemented here: OpenAI's video model (Sora) is
 * not available as a general-purpose REST endpoint the way TTS/images/
 * transcription are -- most API keys can't call it. `generateVideo` throws a
 * clear, typed error instead of silently failing against a guessed endpoint. */

export type TtsVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" | "ash" | "coral" | "sage";

export interface GenerateVoiceRequest {
  text: string;
  voice?: TtsVoice;
}

export interface GenerateVoiceResult {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

const DEFAULT_VOICE: TtsVoice = "alloy";
const TTS_MODEL = "gpt-4o-mini-tts";

function requireApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Add it to sidecar/.env and restart the sidecar.");
  }
  return apiKey;
}

export async function generateVoiceover(request: GenerateVoiceRequest): Promise<GenerateVoiceResult> {
  const apiKey = requireApiKey();
  const text = request.text.trim();
  if (!text) throw new Error("text must not be empty");

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: request.voice ?? DEFAULT_VOICE,
      input: text,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI TTS error (${response.status}): ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType: "audio/mpeg", extension: ".mp3" };
}

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export interface GenerateImageRequest {
  prompt: string;
  /** defaults to a 9:16-ish portrait size -- this project's compositions are
   * vertical short-form video by default (see DEFAULT_WIDTH/HEIGHT in
   * shared/render-plan.ts), so portrait is the more useful default than a
   * square image most callers would immediately have to crop. */
  size?: ImageSize;
}

export interface GenerateImageResult {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

const DEFAULT_IMAGE_SIZE: ImageSize = "1024x1536";
const IMAGE_MODEL = "gpt-image-1";

interface OpenAiImageResponse {
  data?: { b64_json?: string }[];
}

export async function generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
  const apiKey = requireApiKey();
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error("prompt must not be empty");

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      size: request.size ?? DEFAULT_IMAGE_SIZE,
      n: 1,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI image generation error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as OpenAiImageResponse;
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image generation returned no image data");

  return { buffer: Buffer.from(b64, "base64"), mimeType: "image/png", extension: ".png" };
}

/** Thrown by generateVideo -- kept distinct from a generic Error so routes
 * can map it to a 501 rather than a 500, since this isn't a transient
 * failure, it's a capability that isn't wired up. */
export class VideoGenerationUnavailableError extends Error {
  constructor() {
    super(
      "AI video generation is not available: OpenAI's video model (Sora) is not a general-availability REST " +
        "endpoint most API keys can call, unlike TTS/images/transcription. Wire up a video-gen provider you " +
        "have access to (Sora API access, or a third-party model) before enabling this.",
    );
    this.name = "VideoGenerationUnavailableError";
  }
}

export async function generateVideo(): Promise<never> {
  throw new VideoGenerationUnavailableError();
}
