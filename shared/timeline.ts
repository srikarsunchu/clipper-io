import type { AiGeneration } from "./ai-edit";

export type TrackKind = "video" | "caption" | "broll" | "audio";
export type TimelineItemKind = "media" | "image" | "text" | "audio" | "generated";

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
}

export interface ClipTransform {
  scale: number;
  x: number;
  y: number;
}

export interface Clip {
  id: string;
  trackId: string;
  mediaId: string;
  /** Placed-item discriminator. Missing values from legacy projects normalize to `media`. */
  kind?: TimelineItemKind;
  /** trim in-point within the source media, seconds */
  inSec: number;
  /** trim out-point within the source media, seconds */
  outSec: number;
  /** position of this clip on the timeline, seconds */
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
  /** JSON project schema. Legacy projects without this field are version 1. */
  schemaVersion?: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  media: MediaAsset[];
  tracks: Track[];
  clips: Clip[];
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
  sourceTimelineSnapshot?: Clip[] | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  durationSec: number;
}
