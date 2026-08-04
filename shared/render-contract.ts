export type CaptionStyleId =
  | "pop"
  | "mozi"
  | "deepdiver"
  | "popline"
  | "karaoke"
  | "clean"
  | "boxed"
  | "thinkmedia";

export interface RenderWord {
  word: string;
  editStart: number;
  editEnd: number;
}

export interface RenderCue {
  editStart: number;
  editEnd: number;
  words: RenderWord[];
}

export interface RenderSegment {
  src: string;
  trimStartSec: number;
  trimEndSec: number;
  sequenceStartSec: number;
  sourceWidth: number;
  sourceHeight: number;
  /** face-track points already scoped to this segment's own media -- never a
   * shared, timeline-wide list, so one media's positions can never leak into
   * another media's segment */
  facePoints: RenderFacePoint[];
  /** edit-time ranges (matching `facePoints`' time base) that were actually
   * tracked; interpolation outside these ranges must return null rather than
   * clamp to an unrelated point */
  faceCoverage: RenderFaceRange[];
}

export interface RenderFacePoint {
  editTimeSec: number;
  centerX: number;
  centerY: number;
}

/** Edit-time-relative range, seconds -- the render-time counterpart of the
 * source-media-relative `FaceTrackRange` in shared/timeline.ts. */
export interface RenderFaceRange {
  startSec: number;
  endSec: number;
}
