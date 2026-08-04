import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { CaptionStyleId, RenderCue, RenderSegment } from "../remotion/CaptionedTimeline.js";

let cachedBundleUrl: Promise<string> | null = null;

function getBundleUrl(): Promise<string> {
  if (!cachedBundleUrl) {
    cachedBundleUrl = bundle({
      entryPoint: path.join(import.meta.dirname, "..", "remotion", "index.tsx"),
    });
  }
  return cachedBundleUrl;
}

export interface RenderCaptionedVideoOptions {
  segments: RenderSegment[];
  cues: RenderCue[];
  style: CaptionStyleId;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  outputPath: string;
}

export async function renderCaptionedVideo(options: RenderCaptionedVideoOptions): Promise<void> {
  const serveUrl = await getBundleUrl();
  const inputProps = {
    segments: options.segments,
    cues: options.cues,
    style: options.style,
    durationSec: options.durationSec,
    width: options.width,
    height: options.height,
    fps: options.fps,
  };

  const composition = await selectComposition({
    serveUrl,
    id: "CaptionedTimeline",
    inputProps,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: options.outputPath,
    inputProps,
  });
}
