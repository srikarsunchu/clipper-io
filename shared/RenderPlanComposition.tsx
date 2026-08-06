import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, useCurrentFrame } from "remotion";
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import type {
  AudioLayer,
  CaptionLayer,
  CaptionStyleId,
  ImageLayer,
  RenderCue,
  RenderPlan,
  TextLayer,
  VideoLayer,
} from "./render-contract";
import { interpolateFacePoint } from "./timeline-math";

const { fontFamily: antonFont } = loadAnton("normal", { weights: ["400"], subsets: ["latin"] });
const { fontFamily: interFont } = loadInter("normal", { weights: ["800"], subsets: ["latin"] });
const { fontFamily: poppinsFont } = loadPoppins("normal", { weights: ["800"], subsets: ["latin"] });

export type RenderPlanCompositionProps = { plan: RenderPlan };

export function calculateRenderPlanMetadata({ props }: { props: RenderPlanCompositionProps }) {
  return {
    durationInFrames: Math.max(1, Math.round(props.plan.durationSec * props.plan.fps)),
    fps: props.plan.fps,
    width: props.plan.width,
    height: props.plan.height,
  };
}

interface StylePreset {
  fontFamily: string;
  fontSize: number;
  color: string;
  strokeColor: string | null;
  strokeRatio: number;
  highlight: string;
  background: string | null;
  uppercase: boolean;
  letterSpacing: string;
  shadow: string | null;
  motion: "bounce" | "punch" | "rise" | "pop" | "track" | "fade" | "snap" | "slide";
  activeBackground?: string;
}

// These presets mirror the visual grammar used by leading short-form editors:
// short chunks, heavy mobile-safe type, spoken-word tracking, and restrained motion.
const STYLE_PRESETS: Record<CaptionStyleId, StylePreset> = {
  pop: {
    fontFamily: antonFont,
    fontSize: 0.1,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeRatio: 1 / 6,
    highlight: "#F7C204",
    background: null,
    uppercase: true,
    letterSpacing: "0.015em",
    shadow: "0 0.08em 0 #000000",
    motion: "bounce",
  },
  mozi: {
    fontFamily: antonFont,
    fontSize: 0.092,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeRatio: 1 / 7,
    highlight: "#d7ff53",
    background: null,
    uppercase: true,
    letterSpacing: "0.025em",
    shadow: "0 0.07em 0 #000000",
    motion: "punch",
  },
  deepdiver: {
    fontFamily: poppinsFont,
    fontSize: 0.071,
    color: "#ffffff",
    strokeColor: "#07111f",
    strokeRatio: 1 / 10,
    highlight: "#58d6ff",
    background: null,
    uppercase: true,
    letterSpacing: "0.075em",
    shadow: "0 0 0.22em rgba(88,214,255,0.5)",
    motion: "rise",
  },
  popline: {
    fontFamily: interFont,
    fontSize: 0.074,
    color: "#ffffff",
    strokeColor: "#000000",
    strokeRatio: 1 / 12,
    highlight: "#fd72bf",
    background: null,
    uppercase: false,
    letterSpacing: "-0.025em",
    shadow: "0 0.06em 0.12em rgba(0,0,0,0.45)",
    motion: "pop",
  },
  clean: {
    fontFamily: interFont,
    fontSize: 0.065,
    color: "#ffffff",
    strokeColor: null,
    strokeRatio: 0,
    highlight: "#ffffff",
    background: "rgba(0,0,0,0.55)",
    uppercase: false,
    letterSpacing: "-0.02em",
    shadow: null,
    motion: "fade",
  },
  boxed: {
    fontFamily: antonFont,
    fontSize: 0.08,
    color: "#111111",
    strokeColor: null,
    strokeRatio: 0,
    highlight: "#ffffff",
    background: "transparent",
    uppercase: true,
    letterSpacing: "0.02em",
    shadow: "0 0.06em 0.12em rgba(0,0,0,0.28)",
    motion: "snap",
    activeBackground: "#2f6fed",
  },
  karaoke: {
    fontFamily: poppinsFont,
    fontSize: 0.075,
    color: "#9a9a9a",
    strokeColor: null,
    strokeRatio: 0,
    highlight: "#d7ff53",
    background: null,
    uppercase: false,
    letterSpacing: "-0.02em",
    shadow: "0 0.06em 0.12em rgba(0,0,0,0.5)",
    motion: "track",
    activeBackground: "rgba(215,255,83,0.14)",
  },
  thinkmedia: {
    fontFamily: interFont,
    fontSize: 0.068,
    color: "#ffffff",
    strokeColor: null,
    strokeRatio: 0,
    highlight: "#58d6ff",
    background: "rgba(8,10,16,0.78)",
    uppercase: false,
    letterSpacing: "-0.025em",
    shadow: null,
    motion: "slide",
  },
};

/** The single Remotion composition, driven exclusively by a `RenderPlan`.
 * Used both by the sidecar's server-side renderer and (via `@remotion/player`)
 * by the live editor preview -- there is no second implementation to drift
 * out of sync with this one. */
export const RenderPlanComposition: React.FC<RenderPlanCompositionProps> = ({ plan }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {plan.layers.map((layer, index) => {
        switch (layer.kind) {
          case "video": {
            const fromFrame = Math.round(layer.sequenceStartSec * plan.fps);
            const durationFrames = Math.max(1, Math.round((layer.trimEndSec - layer.trimStartSec) * plan.fps));
            return (
              <Sequence key={index} from={fromFrame} durationInFrames={durationFrames} layout="none">
                <VideoLayerView layer={layer} compositionWidth={plan.width} compositionHeight={plan.height} fps={plan.fps} />
              </Sequence>
            );
          }
          case "image": {
            const fromFrame = Math.round(layer.sequenceStartSec * plan.fps);
            const durationFrames = Math.max(1, Math.round(layer.durationSec * plan.fps));
            return (
              <Sequence key={index} from={fromFrame} durationInFrames={durationFrames} layout="none">
                <ImageLayerView layer={layer} compositionWidth={plan.width} compositionHeight={plan.height} durationFrames={durationFrames} />
              </Sequence>
            );
          }
          case "text": {
            const fromFrame = Math.round(layer.sequenceStartSec * plan.fps);
            const durationFrames = Math.max(1, Math.round(layer.durationSec * plan.fps));
            return (
              <Sequence key={index} from={fromFrame} durationInFrames={durationFrames} layout="none">
                <TextLayerView layer={layer} />
              </Sequence>
            );
          }
          case "audio": {
            const fromFrame = Math.round(layer.sequenceStartSec * plan.fps);
            const durationFrames = Math.max(1, Math.round((layer.trimEndSec - layer.trimStartSec) * plan.fps));
            return (
              <Sequence key={index} from={fromFrame} durationInFrames={durationFrames} layout="none">
                <AudioLayerView layer={layer} fps={plan.fps} />
              </Sequence>
            );
          }
          case "captions": {
            return <CaptionLayerView key={index} layer={layer} fps={plan.fps} width={plan.width} />;
          }
          default:
            return null;
        }
      })}
    </AbsoluteFill>
  );
};

function VideoLayerView({ layer, compositionWidth, compositionHeight, fps }: {
  layer: VideoLayer; compositionWidth: number; compositionHeight: number; fps: number;
}) {
  const frame = useCurrentFrame();
  const currentEditTime = layer.sequenceStartSec + frame / fps;
  // facePoints/faceCoverage are already scoped to this layer's own media, so
  // there's no risk of resolving a different layer's tracked position here.
  const point = interpolateFacePoint(layer.facePoints, layer.faceCoverage, currentEditTime) ?? {
    centerX: 0.5,
    centerY: 0.5,
  };

  // Cover-fit math: scale the source up so it fully covers the output frame, then
  // pan so the tracked face center lands at the output's center, clamped so the
  // video never shows a gap at its edges.
  const scale = Math.max(compositionWidth / layer.sourceWidth, compositionHeight / layer.sourceHeight);
  const scaledWidth = layer.sourceWidth * scale;
  const scaledHeight = layer.sourceHeight * scale;

  const desiredLeft = point.centerX * scaledWidth - compositionWidth / 2;
  const cropLeft = Math.max(0, Math.min(scaledWidth - compositionWidth, desiredLeft));
  const desiredTop = point.centerY * scaledHeight - compositionHeight / 2;
  const cropTop = Math.max(0, Math.min(scaledHeight - compositionHeight, desiredTop));

  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity: layer.opacity }}>
      <div style={{ position: "absolute", width: scaledWidth, height: scaledHeight, left: -cropLeft, top: -cropTop }}>
        <OffthreadVideo
          src={layer.src}
          startFrom={Math.round(layer.trimStartSec * fps)}
          pauseWhenBuffering
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </AbsoluteFill>
  );
}

function ImageLayerView({ layer, compositionWidth, compositionHeight, durationFrames }: {
  layer: ImageLayer; compositionWidth: number; compositionHeight: number; durationFrames: number;
}) {
  const frame = useCurrentFrame();
  const sourceWidth = layer.sourceWidth ?? compositionWidth;
  const sourceHeight = layer.sourceHeight ?? compositionHeight;
  const baseScale = Math.max(compositionWidth / sourceWidth, compositionHeight / sourceHeight);

  // Deterministic Ken Burns: a slow, fixed-direction zoom over the layer's
  // full duration -- no randomness, so the same plan always animates the
  // same way in preview and export.
  const progress = durationFrames > 0 ? Math.min(1, frame / durationFrames) : 0;
  const KEN_BURNS_ZOOM = 1.12;
  const zoom =
    layer.motionPreset === "kenBurnsIn"
      ? interpolate(progress, [0, 1], [1, KEN_BURNS_ZOOM])
      : layer.motionPreset === "kenBurnsOut"
        ? interpolate(progress, [0, 1], [KEN_BURNS_ZOOM, 1])
        : 1;

  const scale = baseScale * zoom;
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;

  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity: layer.opacity }}>
      <div
        style={{
          position: "absolute",
          width: scaledWidth,
          height: scaledHeight,
          left: (compositionWidth - scaledWidth) / 2,
          top: (compositionHeight - scaledHeight) / 2,
        }}
      >
        <Img src={layer.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} pauseWhenLoading />
      </div>
    </AbsoluteFill>
  );
}

function TextLayerView({ layer }: { layer: TextLayer }) {
  const justify = layer.alignment === "left" ? "flex-start" : layer.alignment === "right" ? "flex-end" : "center";
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: justify, padding: "0 8%", opacity: layer.opacity }}>
      <div
        style={{
          fontFamily: layer.typography.fontFamily ?? interFont,
          fontSize: layer.typography.fontSize,
          fontWeight: layer.typography.weight,
          color: layer.typography.color,
          textAlign: layer.alignment,
          lineHeight: 1.2,
          whiteSpace: "pre-wrap",
        }}
      >
        {layer.text}
      </div>
    </AbsoluteFill>
  );
}

function AudioLayerView({ layer, fps }: { layer: AudioLayer; fps: number }) {
  const frame = useCurrentFrame();
  const durationFrames = Math.max(1, Math.round((layer.trimEndSec - layer.trimStartSec) * fps));
  const fadeInFrames = Math.round(layer.fadeInSec * fps);
  const fadeOutFrames = Math.round(layer.fadeOutSec * fps);
  let volume = layer.volume;
  if (fadeInFrames > 0 && frame < fadeInFrames) {
    volume *= interpolate(frame, [0, fadeInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  }
  if (fadeOutFrames > 0 && frame > durationFrames - fadeOutFrames) {
    volume *= interpolate(frame, [durationFrames - fadeOutFrames, durationFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  return <Audio src={layer.src} startFrom={Math.round(layer.trimStartSec * fps)} volume={Math.max(0, volume)} pauseWhenBuffering />;
}

function CaptionLayerView({ layer, fps, width }: { layer: CaptionLayer; fps: number; width: number }) {
  const preset = STYLE_PRESETS[layer.style] ?? STYLE_PRESETS.pop;
  return (
    <>
      {layer.cues.map((cue, index) => {
        const fromFrame = Math.round(cue.editStart * fps);
        const durationFrames = Math.max(1, Math.round((cue.editEnd - cue.editStart) * fps));
        return (
          <Sequence key={index} from={fromFrame} durationInFrames={durationFrames} layout="none">
            <CaptionCueOverlay cue={cue} preset={preset} fps={fps} width={width} />
          </Sequence>
        );
      })}
    </>
  );
}

function CaptionCueOverlay({ cue, preset, fps, width }: { cue: RenderCue; preset: StylePreset; fps: number; width: number }) {
  const frame = useCurrentFrame();
  const entrance = spring({
    frame,
    fps,
    config: preset.motion === "bounce" ? { damping: 9, stiffness: 220 } : { damping: 200 },
    durationInFrames: preset.motion === "fade" ? 8 : 6,
  });
  const scale = interpolate(entrance, [0, 1], [preset.motion === "punch" ? 0.68 : 0.86, 1]);
  const translateY = preset.motion === "rise" ? interpolate(entrance, [0, 1], [36, 0]) : 0;
  const translateX = preset.motion === "slide" ? interpolate(entrance, [0, 1], [-40, 0]) : 0;
  const currentTime = cue.editStart + frame / fps;
  const fontSize = width * preset.fontSize;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: width * 0.18 }}>
      <div
        style={{
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          opacity: entrance,
          fontFamily: preset.fontFamily,
          fontSize,
          fontWeight: 800,
          textTransform: preset.uppercase ? "uppercase" : "none",
          color: preset.color,
          WebkitTextStroke: preset.strokeColor ? `${fontSize * preset.strokeRatio}px ${preset.strokeColor}` : undefined,
          paintOrder: "stroke fill",
          background: preset.background ?? undefined,
          padding: preset.background ? "0.24em 0.5em" : undefined,
          borderRadius: preset.background ? 12 : undefined,
          textAlign: "center",
          maxWidth: "88%",
          lineHeight: 1.12,
          letterSpacing: preset.letterSpacing,
          textShadow: preset.shadow ?? undefined,
        }}
      >
        {cue.words.map((word, wordIndex) => {
          const isActive = currentTime >= word.editStart && currentTime < word.editEnd;
          const wordProgressEnd = Math.max(word.editStart + 0.001, Math.min(word.editStart + 0.12, word.editEnd));
          const wordProgress = interpolate(currentTime, [word.editStart, wordProgressEnd], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const activeScale = isActive && ["bounce", "punch", "pop", "snap"].includes(preset.motion)
            ? interpolate(wordProgress, [0, 0.55, 1], [0.82, 1.16, 1.06])
            : 1;
          return (
            <span
              key={wordIndex}
              style={{
                color: isActive ? preset.highlight : preset.color,
                display: "inline-block",
                transform: `scale(${activeScale})`,
                transformOrigin: "center bottom",
                background: isActive ? preset.activeBackground : preset.background === "transparent" ? "#ffffff" : undefined,
                padding: preset.activeBackground || preset.background === "transparent" ? "0.02em 0.09em" : undefined,
                borderRadius: preset.activeBackground ? "0.08em" : undefined,
                margin: preset.background === "transparent" ? "0.03em" : undefined,
              }}
            >
              {word.word}{" "}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
