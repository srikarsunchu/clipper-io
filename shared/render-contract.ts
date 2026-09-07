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

export type LayerFit = "cover" | "contain";

export interface VideoLayer {
  kind: "video";
  src: string;
  trimStartSec: number;
  trimEndSec: number;
  sequenceStartSec: number;
  sourceWidth: number;
  sourceHeight: number;
  fit: LayerFit;
  opacity: number;
  /** extra zoom on top of the cover-fit (and face-tracking pan, when
   * present) scale -- the persisted counterpart of the editor's per-clip
   * "Transform > Scale" control. 1 = no extra zoom. */
  manualScale: number;
  /** already scoped to this layer's own media -- never a shared, timeline-wide
   * list, so one media's positions can never leak into another's layer */
  facePoints: RenderFacePoint[];
  faceCoverage: RenderFaceRange[];
}

export interface ImageLayer {
  kind: "image";
  src: string;
  sequenceStartSec: number;
  durationSec: number;
  sourceWidth?: number;
  sourceHeight?: number;
  fit: LayerFit;
  opacity: number;
  motionPreset: "kenBurnsIn" | "kenBurnsOut" | "none";
}

export interface TextLayer {
  kind: "text";
  sequenceStartSec: number;
  durationSec: number;
  opacity: number;
  text: string;
  typography: {
    fontFamily?: string;
    fontSize: number;
    color: string;
    weight: number;
  };
  alignment: "left" | "center" | "right";
}

export interface AudioLayer {
  kind: "audio";
  src: string;
  trimStartSec: number;
  trimEndSec: number;
  sequenceStartSec: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
}

export interface CaptionLayer {
  kind: "captions";
  style: CaptionStyleId;
  cues: RenderCue[];
  /** overrides the style preset's own accent/highlight color without
   * touching its layout -- the preset still owns placement, motion, and
   * type; this is the one thing a caller may recolor per-project. */
  accentOverride?: string;
}

/** Local transform applied around a group's own center -- composed on top of
 * (not replacing) each child's own transform when the group is flattened to
 * layers. */
export interface GroupTransform {
  scale: number;
  x: number;
  y: number;
  rotationDeg: number;
}

export interface GroupLayer {
  kind: "group";
  sequenceStartSec: number;
  durationSec: number;
  opacity: number;
  transform: GroupTransform;
  /** already flattened, edit-time-absolute child layers -- a group never
   * needs a second pass of local-to-absolute-time math at render time. */
  children: RenderLayer[];
}

export interface HtmlOverlayLayer {
  kind: "htmlOverlay";
  sequenceStartSec: number;
  durationSec: number;
  opacity: number;
  template: string;
  props: Record<string, unknown>;
}

export type RenderLayer =
  | VideoLayer
  | ImageLayer
  | TextLayer
  | AudioLayer
  | CaptionLayer
  | GroupLayer
  | HtmlOverlayLayer;

/** Everything Remotion needs to render one composition, and nothing it needs
 * to infer -- resolved asset URLs, resolved edit-time positions, resolved
 * face-track data already scoped per layer. Built once by `buildRenderPlan`
 * from a `Project` and consumed identically by the live editor preview
 * (`@remotion/player`) and the server-side export (`@remotion/renderer`), so
 * the two can never resolve a given point in time differently. */
export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  /** back-to-front paint order */
  layers: RenderLayer[];
  /** deterministic hash of this plan's content -- same project state (as seen
   * by buildRenderPlan) always produces the same hash, so a render pipeline
   * can use it as a cache key without re-deriving equality itself. */
  planHash: string;
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
