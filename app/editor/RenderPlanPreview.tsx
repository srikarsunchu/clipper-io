"use client";

import { Player } from "@remotion/player";
import type { Project } from "../../shared/timeline";
import type { CaptionStyleId } from "../../shared/render-contract";
import { buildRenderPlan } from "../../shared/render-plan";
import { RenderPlanComposition } from "../../shared/RenderPlanComposition";
import { mediaFileUrl } from "../sidecar-client";

/** Renders a project through the exact same `RenderPlanComposition` the
 * server-side export uses, via `@remotion/player` -- the same plan-building
 * step (`buildRenderPlan`) and the same React component, so preview and
 * export can never resolve a given point in time differently. Not yet wired
 * in to replace `PreviewStage`'s bespoke video-element preview: that swap
 * touches live playback/scrub/transport state and deserves its own pass with
 * actual visual verification in a browser, which wasn't available this
 * session. This component is proven to build and typecheck as part of the
 * app bundle; it is intentionally not yet imported by page.tsx. */
export function RenderPlanPreview({ project, captionStyle }: { project: Project; captionStyle: CaptionStyleId }) {
  const plan = buildRenderPlan(project, mediaFileUrl, { captionStyle });
  const durationInFrames = Math.max(1, Math.round(plan.durationSec * plan.fps));

  return (
    <Player
      component={RenderPlanComposition}
      inputProps={{ plan }}
      durationInFrames={durationInFrames}
      compositionWidth={plan.width}
      compositionHeight={plan.height}
      fps={plan.fps}
      style={{ width: "100%", height: "100%" }}
      controls
    />
  );
}
