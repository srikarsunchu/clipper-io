import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TranscriptWord } from "../../shared/timeline.js";

const execFileAsync = promisify(execFile);

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperResponse {
  words?: WhisperWord[];
}

export async function transcribeMedia(filePath: string): Promise<TranscriptWord[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Add it to sidecar/.env and restart the sidecar.");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clipwire-transcribe-"));
  const audioPath = path.join(tempDir, "audio.mp3");

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", filePath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "64k",
      audioPath,
    ]);

    const audioBuffer = await readFile(audioPath);
    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), "audio.mp3");
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "word");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Whisper API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as WhisperResponse;
    return (data.words ?? []).map((word) => ({ word: word.word, start: word.start, end: word.end }));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
