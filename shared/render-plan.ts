import type { CaptionStyleId, RenderPlan, RenderLayer, VideoLayer, ImageLayer, TextLayer, AudioLayer } from "./render-contract.ts";
import type { Project, TimelineItem, Track } from "./timeline.ts";
import {
  buildCaptionCues,
  buildRenderCues,
  mapCuesToEditTime,
  mapFaceRangesToEditTime,
  mapFaceTrackToEditTime,
  normalizeProject,
  readMediaFaceTrack,
  timelineDuration,
} from "./timeline-math.ts";

export interface BuildRenderPlanOptions {
  width?: number;
  height?: number;
  fps?: number;
  captionStyle?: CaptionStyleId;
}

/** Resolves a media asset id to whatever URL the *caller's* environment can
 * actually fetch it from -- injected rather than hardcoded so a future remote
 * renderer or CDN-backed asset store can supply a different resolver without
 * buildRenderPlan itself changing. */
export type AssetUrlResolver = (assetId: string) => string;

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_FPS = 30;
const DEFAULT_CAPTION_STYLE: CaptionStyleId = "pop";

/** Pure, deterministic: the same project content and the same resolver output
 * always produce the same plan (and the same `planHash`). No wall-clock time,
 * no randomness, no I/O beyond calling the injected resolver. This is what
 * lets a Project -> RenderPlan step feed both the live `@remotion/player`
 * preview and the server-side `@remotion/renderer` export from one source of
 * truth, and what will let render jobs cache by plan hash later. */
export function buildRenderPlan(
  rawProject: Project,
  resolveAssetUrl: AssetUrlResolver,
  options: BuildRenderPlanOptions = {},
): RenderPlan {
  const project = normalizeProject(rawProject);
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const fps = options.fps ?? DEFAULT_FPS;
  const captionStyle = options.captionStyle ?? DEFAULT_CAPTION_STYLE;

  const tracksById = new Map<string, Track>(project.tracks.map((track) => [track.id, track]));
  const orderedItems = [...project.clips].sort((a, b) => {
    const trackOrderA = tracksById.get(a.trackId)?.order ?? 0;
    const trackOrderB = tracksById.get(b.trackId)?.order ?? 0;
    if (trackOrderA !== trackOrderB) return trackOrderA - trackOrderB;
    const layerOrderA = a.layerOrder ?? 0;
    const layerOrderB = b.layerOrder ?? 0;
    if (layerOrderA !== layerOrderB) return layerOrderA - layerOrderB;
    return a.startSec - b.startSec;
  });

  const layers: RenderLayer[] = orderedItems.map((item) => buildLayerForItem(item, project, resolveAssetUrl));

  if (project.transcript?.length && project.transcriptMediaId) {
    const cues = buildCaptionCues(project.transcript);
    const editCues = mapCuesToEditTime(cues, project.clips, project.transcriptMediaId);
    const renderCues = buildRenderCues(editCues);
    if (renderCues.length) {
      // Captions always paint on top of every other layer, regardless of
      // track order -- there is no product scenario yet where anything
      // should occlude them.
      layers.push({ kind: "captions", style: captionStyle, cues: renderCues });
    }
  }

  const durationSec = timelineDuration(project.clips);

  const plan: Omit<RenderPlan, "planHash"> = { width, height, fps, durationSec, layers };
  return { ...plan, planHash: hashPlan(plan) };
}

function buildLayerForItem(item: TimelineItem, project: Project, resolveAssetUrl: AssetUrlResolver): RenderLayer {
  switch (item.kind) {
    case "video": {
      const media = project.media.find((asset) => asset.id === item.assetId);
      const { points, segments } = readMediaFaceTrack(project, item.assetId);
      const facePoints = mapFaceTrackToEditTime(points, project.clips, item.assetId);
      const faceCoverage = mapFaceRangesToEditTime(segments, project.clips, item.assetId);
      const layer: VideoLayer = {
        kind: "video",
        src: resolveAssetUrl(item.assetId),
        trimStartSec: item.trimInSec,
        trimEndSec: item.trimOutSec,
        sequenceStartSec: item.startSec,
        sourceWidth: media?.width ?? FALLBACK_WIDTH,
        sourceHeight: media?.height ?? FALLBACK_HEIGHT,
        fit: item.fit ?? "cover",
        opacity: item.opacity ?? 1,
        manualScale: item.transform?.scale ?? 1,
        facePoints,
        faceCoverage,
      };
      return layer;
    }
    case "image": {
      const media = project.media.find((asset) => asset.id === item.assetId);
      const layer: ImageLayer = {
        kind: "image",
        src: resolveAssetUrl(item.assetId),
        sequenceStartSec: item.startSec,
        durationSec: item.durationSec,
        sourceWidth: media?.width,
        sourceHeight: media?.height,
        fit: item.fit ?? "cover",
        opacity: item.opacity ?? 1,
        motionPreset: item.motionPreset ?? "none",
      };
      return layer;
    }
    case "text": {
      const layer: TextLayer = {
        kind: "text",
        sequenceStartSec: item.startSec,
        durationSec: item.durationSec,
        opacity: item.opacity ?? 1,
        text: item.text,
        typography: {
          fontFamily: item.typography?.fontFamily,
          fontSize: item.typography?.fontSize ?? 0.08,
          color: item.typography?.color ?? "#ffffff",
          weight: item.typography?.weight ?? 800,
        },
        alignment: item.alignment ?? "center",
      };
      return layer;
    }
    case "audio": {
      const layer: AudioLayer = {
        kind: "audio",
        src: resolveAssetUrl(item.assetId),
        trimStartSec: item.trimInSec,
        trimEndSec: item.trimOutSec,
        sequenceStartSec: item.startSec,
        volume: item.volume ?? 1,
        fadeInSec: item.fades?.inSec ?? 0,
        fadeOutSec: item.fades?.outSec ?? 0,
      };
      return layer;
    }
  }
}

// Fallback source dimensions if a video/image item somehow references a media
// id no longer present in project.media -- keeps buildLayerForItem total
// (never throws on a dangling reference) while still producing a plausible
// 9:16 fallback rather than a 0x0 layer.
const FALLBACK_WIDTH = 1080;
const FALLBACK_HEIGHT = 1920;

/** Small, portable, deterministic string hash (FNV-1a, 32-bit) over a stable
 * JSON encoding of the plan. Deliberately not a cryptographic hash and not
 * Node's `crypto` module -- this needs to run identically in the browser
 * (editor preview) and under Node (sidecar), and it only needs to be a stable
 * cache key, not collision-resistant against adversarial input. */
function hashPlan(plan: Omit<RenderPlan, "planHash">): string {
  const encoded = stableStringify(plan);
  let hash = 0x811c9dc5;
  for (let i = 0; i < encoded.length; i++) {
    hash ^= encoded.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
