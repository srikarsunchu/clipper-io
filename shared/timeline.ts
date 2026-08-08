import type { AiGeneration } from "./ai-edit";

export type TrackKind = "video" | "caption" | "broll" | "audio" | "elements";

export interface MediaAsset {
  id: string;
  fileName: string;
  mimeType: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  createdAt: string;
  /** How this asset came to exist. Every generated output enters the same
   * asset system as uploaded media, so origin is recorded on the asset, not
   * invented as a separate render-behavior "kind" on timeline items. Missing
   * on legacy assets normalizes to `sourceType: "upload"` -- nothing has ever
   * been generated in this project yet. */
  provenance?: AssetProvenance;
}

export interface AssetProvenance {
  sourceType: "upload" | "generated" | "stock" | "derived";
  provider?: string;
  model?: string;
  promptHash?: string;
  generationJobId?: string;
  parentAssetId?: string;
  referenceAssetIds?: string[];
}

export interface ItemTransform {
  scale: number;
  x: number;
  y: number;
}

/** @deprecated kept only so ClipTransform-typed values already persisted in
 * old projects still parse; identical shape to ItemTransform. */
export type ClipTransform = ItemTransform;

export type ItemFit = "cover" | "contain";

interface TimelineItemBase {
  id: string;
  trackId: string;
  /** position of this item on the timeline, seconds */
  startSec: number;
  /** how long this item occupies the timeline, seconds -- the single source
   * of truth for duration across every item kind (for video/audio this must
   * stay in sync with trimInSec/trimOutSec; helpers in timeline-math enforce
   * that rather than callers computing it by hand in two places). */
  durationSec: number;
  /** set when this item was materialized from an approved storyboard scene;
   * lets a future regeneration replace only the items bound to that scene. */
  sceneId?: string;
  transform?: ItemTransform;
  opacity?: number;
  /** explicit stacking override within a track; defaults to track order when absent. */
  layerOrder?: number;
}

export interface VideoItem extends TimelineItemBase {
  kind: "video";
  assetId: string;
  /** trim in-point within the source asset, seconds */
  trimInSec: number;
  /** trim out-point within the source asset, seconds */
  trimOutSec: number;
  fit?: ItemFit;
  muted?: boolean;
  volume?: number;
}

export interface ImageItem extends TimelineItemBase {
  kind: "image";
  assetId: string;
  fit?: ItemFit;
  motionPreset?: "kenBurnsIn" | "kenBurnsOut" | "none";
}

export interface TextItem extends TimelineItemBase {
  kind: "text";
  text: string;
  typography?: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    weight?: number;
  };
  alignment?: "left" | "center" | "right";
  animationPreset?: string;
}

export interface AudioItem extends TimelineItemBase {
  kind: "audio";
  assetId: string;
  trimInSec: number;
  trimOutSec: number;
  volume?: number;
  fades?: { inSec?: number; outSec?: number };
  ducking?: { enabled?: boolean; duckDb?: number };
}

export type TimelineItem = VideoItem | ImageItem | TextItem | AudioItem;

/** @deprecated pre-v2 shape. `normalizeProject` migrates every persisted
 * `Clip` into a `VideoItem` (the only kind that ever existed before v2) on
 * read; nothing new is ever written in this shape. Kept only so legacy JSON
 * still parses/type-checks during migration. */
export interface Clip {
  id: string;
  trackId: string;
  mediaId: string;
  kind?: "media" | "image" | "text" | "audio" | "generated";
  inSec: number;
  outSec: number;
  startSec: number;
  transform?: ClipTransform;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  order: number;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface FaceTrackPoint {
  /** source-media-relative timestamp, seconds */
  timeSec: number;
  /** normalized 0-1 horizontal center of the tracked face */
  centerX: number;
  /** normalized 0-1 vertical center of the tracked face */
  centerY: number;
}

/** Source-media-relative range, seconds. Used to record which portions of a
 * media asset have actually been face-tracked, so interpolation never has to
 * guess at coverage it doesn't have. */
export interface FaceTrackRange {
  startSec: number;
  endSec: number;
}

export interface MediaFaceTrack {
  points: FaceTrackPoint[];
  /** merged, non-overlapping ranges of `points` that have been tracked so far */
  segments: FaceTrackRange[];
  updatedAt: string;
}

export interface Project {
  /** JSON project schema. Legacy projects without this field are version 1
   * (`Clip[]` timeline). Version 2 uses the discriminated `TimelineItem[]`
   * timeline; `normalizeProject` migrates 1 -> 2 on every read. */
  schemaVersion?: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  media: MediaAsset[];
  tracks: Track[];
  /** v2: discriminated timeline items. Pre-migration (v1) persisted JSON has
   * `Clip[]` here instead -- `normalizeProject` is the only place that should
   * ever see that shape. */
  clips: TimelineItem[];
  transcript: TranscriptWord[] | null;
  /** which media asset `transcript` was generated from, since word timestamps are source-media-relative */
  transcriptMediaId: string | null;
  /** @deprecated superseded by `faceTracksByMediaId`. Retained only so old
   * persisted projects still parse; `normalizeProject` migrates this into
   * `faceTracksByMediaId` on read. Never written to by new code. */
  faceTrack: FaceTrackPoint[] | null;
  /** @deprecated see `faceTrack` */
  faceTrackMediaId: string | null;
  /** Per-media face tracking data. A single global track can't work once a
   * timeline references more than one video source -- each media asset needs
   * its own points and its own record of which ranges are actually covered. */
  faceTracksByMediaId?: Record<string, MediaFaceTrack>;
  /** Persisted AI candidate sets, newest last. */
  aiGenerations?: AiGeneration[];
  /** Original timeline retained before the first AI candidate is applied. */
  sourceTimelineSnapshot?: TimelineItem[] | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  durationSec: number;
}
