import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { RenderPlan } from "../../shared/render-contract.js";

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
  plan: RenderPlan;
  outputPath: string;
}

export async function renderCaptionedVideo(options: RenderCaptionedVideoOptions): Promise<void> {
  const serveUrl = await getBundleUrl();
  const inputProps = { plan: options.plan };

  const composition = await selectComposition({
    serveUrl,
    id: "RenderPlanComposition",
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
