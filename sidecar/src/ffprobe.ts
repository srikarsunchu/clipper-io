import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProbedMedia {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type: "video" | "audio" | string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
  format: { duration?: string };
}

function parseFrameRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [num, den] = rate.split("/").map(Number);
  if (!den) return num || 0;
  return num / den;
}

export async function probeMedia(filePath: string): Promise<ProbedMedia> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const videoStream = parsed.streams.find((stream) => stream.codec_type === "video");
  const audioStream = parsed.streams.find((stream) => stream.codec_type === "audio");

  const durationSec = Number(parsed.format.duration ?? videoStream?.duration ?? 0);
  const fps = parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate);

  return {
    durationSec,
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    fps,
    hasAudio: Boolean(audioStream),
  };
}
