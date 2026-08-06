"use client";

import { forwardRef, useMemo } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { CaptionStyleId } from "../../shared/render-contract";
import type { Project } from "../../shared/timeline";
import { buildRenderPlan } from "../../shared/render-plan";
import { RenderPlanComposition } from "../../shared/RenderPlanComposition";
import { mediaFileUrl } from "../sidecar-client";

type Layout = "focus" | "split" | "gameplay";

/** Live editor preview -- renders through the exact same `buildRenderPlan` +
 * `RenderPlanComposition` the server-side export uses (via `@remotion/player`),
 * so a given project state can never look different in the preview than it
 * renders in the final MP4. Playback is controlled imperatively through the
 * forwarded `PlayerRef` (play/pause/seekTo) rather than a raw `<video>`
 * element, since the composition already handles multi-clip sequencing,
 * face-tracking pan, and captions internally. */
export const PreviewStage = forwardRef<PlayerRef, {
  project: Project | null;
  hasMedia: boolean;
  layout: Layout;
  zoom: number;
  captionsOn: boolean;
  captionStyle: CaptionStyleId;
  currentTime: number;
  totalDuration: number;
  playing: boolean;
  muted: boolean;
  onZoomChange: (zoom: number) => void;
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
  onToggleMute: () => void;
}>(function PreviewStage(
  {
    project,
    hasMedia,
    layout,
    zoom,
    captionsOn,
    captionStyle,
    currentTime,
    totalDuration,
    playing,
    muted,
    onZoomChange,
    onTogglePlayback,
    onSeek,
    onToggleMute,
  },
  playerRef,
) {
  const plan = useMemo(() => {
    if (!project) return null;
    const full = buildRenderPlan(project, mediaFileUrl, { captionStyle });
    // Captions on/off is a preview-only toggle -- export always burns them in
    // when a transcript exists, so this filters the *preview's* plan only,
    // never buildRenderPlan's own output.
    if (captionsOn) return full;
    return { ...full, layers: full.layers.filter((layer) => layer.kind !== "captions") };
  }, [project, captionStyle, captionsOn]);
  const durationInFrames = plan ? Math.max(1, Math.round(plan.durationSec * plan.fps)) : 1;

  return (
    <section className="stage-zone">
      <div className="stage-toolbar">
        <div>
          <button aria-label="Zoom out preview" onClick={() => onZoomChange(Math.max(40, zoom - 8))}>−</button>
          <span>{zoom}%</span>
          <button aria-label="Zoom in preview" onClick={() => onZoomChange(Math.min(120, zoom + 8))}>＋</button>
          <button onClick={() => onZoomChange(72)}>Fit</button>
        </div>
        <div><span className="preview-mode-label">Preview · 9:16</span></div>
      </div>
      <div className="canvas-space">
        <div className={`video-canvas layout-${layout}`} style={{ transform: `scale(${zoom / 100})` }}>
          {hasMedia && plan ? (
            <Player
              ref={playerRef}
              component={RenderPlanComposition}
              inputProps={{ plan }}
              durationInFrames={durationInFrames}
              compositionWidth={plan.width}
              compositionHeight={plan.height}
              fps={plan.fps}
              style={{ width: "100%", height: "100%" }}
              initialFrame={Math.round(currentTime * plan.fps)}
              clickToPlay={false}
              doubleClickToFullscreen={false}
            />
          ) : (
            <div className="empty-canvas">
              <span>▧</span>
              <strong>Add media to start</strong>
              <small>Your 9:16 composition will appear here</small>
            </div>
          )}
          {hasMedia && <div className="selection-box"><i className="handle tl" /><i className="handle tr" /><i className="handle bl" /><i className="handle br" /></div>}
        </div>
      </div>
      <div className="transport">
        <div className="transport-left">
          <button aria-label="Go to start" onClick={() => onSeek(0)}>│‹</button>
          <button onClick={() => onSeek(Math.max(0, currentTime - 5))}>−5</button>
          <button className="transport-play" aria-label={playing ? "Pause" : "Play"} onClick={onTogglePlayback}>{playing ? "Ⅱ" : "▶"}</button>
          <button onClick={() => onSeek(Math.min(totalDuration, currentTime + 5))}>+5</button>
          <button aria-label="Go to end" onClick={() => onSeek(totalDuration)}>›│</button>
        </div>
        <div className="timecode"><b>{formatTimecode(currentTime)}</b><span>/ {formatTimecode(totalDuration)}</span></div>
        <div className="transport-right">
          <button aria-label={muted ? "Unmute" : "Mute"} onClick={onToggleMute}>{muted ? "M" : "◖))"}</button>
          <span className="preview-quality">Full</span>
        </div>
      </div>
    </section>
  );
});

function formatTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const whole = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * 30);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
