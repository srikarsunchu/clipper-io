import type {
  AudioItem,
  Clip,
  FaceTrackPoint,
  FaceTrackRange,
  ImageItem,
  ItemTransform,
  MediaFaceTrack,
  Project,
  TextItem,
  TimelineItem,
  TranscriptWord,
  VideoItem,
} from "./timeline";
import type { RenderCue, RenderFacePoint, RenderFaceRange } from "./render-contract";

export interface CaptionCue {
  words: TranscriptWord[];
  start: number;
  end: number;
}

export interface EditCaptionCue extends CaptionCue {
  editStart: number;
  editEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

export function isVideoItem(item: TimelineItem): item is VideoItem {
  return item.kind === "video";
}

export function isImageItem(item: TimelineItem): item is ImageItem {
  return item.kind === "image";
}

export function isTextItem(item: TimelineItem): item is TextItem {
  return item.kind === "text";
}

export function isAudioItem(item: TimelineItem): item is AudioItem {
  return item.kind === "audio";
}

/** The only place a video item's trim should be changed -- keeps
 * `durationSec` (the single cross-kind source of truth for how long an item
 * occupies the timeline) in sync with the trim points automatically, rather
 * than relying on every caller to remember to update both. */
export function withVideoTrim(item: VideoItem, trimInSec: number, trimOutSec: number): VideoItem {
  return { ...item, trimInSec, trimOutSec, durationSec: Math.max(0, trimOutSec - trimInSec) };
}

/** Same contract as `withVideoTrim`, for the other item kind with a source
 * trim window. Kept as a separate function rather than a generic one over
 * both kinds so each stays a plain, obviously-total function over its own
 * concrete type -- no runtime kind-narrowing inside the helper itself. */
export function withAudioTrim(item: AudioItem, trimInSec: number, trimOutSec: number): AudioItem {
  return { ...item, trimInSec, trimOutSec, durationSec: Math.max(0, trimOutSec - trimInSec) };
}

/** Image/text items have no source trim window -- their duration is the
 * whole of what they are, so "resizing" them on the timeline just sets
 * `durationSec` directly rather than deriving it from trim points. */
export function withItemDuration<T extends ImageItem | TextItem>(item: T, durationSec: number): T {
  return { ...item, durationSec: Math.max(0.1, durationSec) };
}

/** Generic timeline-position duration -- valid for every item kind, since
 * `durationSec` is the single source of truth regardless of what the item
 * actually is. Kept as its own function (rather than inlining `.durationSec`
 * everywhere) so call sites read the same either way old Clip-based code did. */
export function clipDuration(item: TimelineItem): number {
  return Math.max(0, item.durationSec);
}

export function timelineDuration(items: TimelineItem[]): number {
  return items.reduce((duration, item) => Math.max(duration, item.startSec + clipDuration(item)), 0);
}

export function findClipAtTime(items: TimelineItem[], time: number): TimelineItem | null {
  if (!items.length) return null;
  return items.find((item) => time >= item.startSec && time < item.startSec + clipDuration(item)) ?? null;
}

/** Merges transcript words into contiguous speech-active intervals -- gaps
 * under `gapThresholdSec` don't split an interval. A coarse "is anyone
 * talking right now" signal, not speaker-attributed; used to gate face
 * tracking's speaker-switch heuristic so mouth-movement noise during a pause
 * (a yawn, chewing, a silent reaction) isn't mistaken for a change in who's
 * speaking. Deliberately not capped by word count/char length the way
 * `buildCaptionCues` is -- those caps exist for on-screen caption legibility,
 * which is irrelevant here and would only over-segment a real speech run. */
export function buildSpeechIntervals(words: TranscriptWord[], gapThresholdSec = 0.6): { start: number; end: number }[] {
  if (!words.length) return [];
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const intervals: { start: number; end: number }[] = [];
  let current = { start: sorted[0].start, end: sorted[0].end };
  for (const word of sorted.slice(1)) {
    if (word.start - current.end > gapThresholdSec) {
      intervals.push(current);
      current = { start: word.start, end: word.end };
    } else {
      current.end = Math.max(current.end, word.end);
    }
  }
  intervals.push(current);
  return intervals;
}

export function buildCaptionCues(words: TranscriptWord[]): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (!current.length) return;
    cues.push({ words: current, start: current[0].start, end: current[current.length - 1].end });
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    const gapTooLong = previous ? word.start - previous.end > 0.6 : false;
    const charsSoFar = current.reduce((sum, existing) => sum + existing.word.length + 1, 0);
    if (gapTooLong || charsSoFar > 42 || current.length >= 8) flush();
    current.push(word);
  }
  flush();
  return cues;
}

export function mapCuesToEditTime(
  cues: CaptionCue[],
  items: TimelineItem[],
  transcriptMediaId: string | null,
): EditCaptionCue[] {
  if (!transcriptMediaId) return [];
  const mapped: EditCaptionCue[] = [];
  for (const item of items.filter(isVideoItem).filter((candidate) => candidate.assetId === transcriptMediaId)) {
    for (const cue of cues) {
      const overlapStart = Math.max(cue.start, item.trimInSec);
      const overlapEnd = Math.min(cue.end, item.trimOutSec);
      if (overlapEnd <= overlapStart) continue;
      mapped.push({
        ...cue,
        editStart: item.startSec + overlapStart - item.trimInSec,
        editEnd: item.startSec + overlapEnd - item.trimInSec,
        sourceStart: overlapStart,
        sourceEnd: overlapEnd,
      });
    }
  }
  return mapped.sort((a, b) => a.editStart - b.editStart);
}

export function buildRenderCues(editCues: EditCaptionCue[]): RenderCue[] {
  return editCues.map((cue) => {
    const offset = cue.editStart - cue.sourceStart;
    return {
      editStart: cue.editStart,
      editEnd: cue.editEnd,
      words: cue.words
        .filter((word) => word.end > cue.sourceStart && word.start < cue.sourceEnd)
        .map((word) => ({ word: word.word, editStart: word.start + offset, editEnd: word.end + offset })),
    };
  });
}

/** Maps a single media's tracked points into edit-time for whichever of the
 * given items reference that exact media -- items for any other media (or
 * non-video items) are ignored, so a caller can never accidentally get media
 * A's points back out under media B's identity by passing the wrong item list. */
export function mapFaceTrackToEditTime(points: FaceTrackPoint[], items: TimelineItem[], mediaId: string): RenderFacePoint[] {
  const mapped: RenderFacePoint[] = [];
  for (const item of items.filter(isVideoItem).filter((candidate) => candidate.assetId === mediaId)) {
    for (const point of points) {
      if (point.timeSec < item.trimInSec || point.timeSec > item.trimOutSec) continue;
      mapped.push({
        editTimeSec: item.startSec + point.timeSec - item.trimInSec,
        centerX: point.centerX,
        centerY: point.centerY,
      });
    }
  }
  return mapped.sort((a, b) => a.editTimeSec - b.editTimeSec);
}

/** Same mapping as `mapFaceTrackToEditTime`, but for the tracked *coverage*
 * ranges rather than the points themselves -- lets interpolation tell "no one
 * tracked this part of the clip" apart from "tracked, and the face happened to
 * sit at the nearest known point." */
export function mapFaceRangesToEditTime(ranges: FaceTrackRange[], items: TimelineItem[], mediaId: string): RenderFaceRange[] {
  const mapped: RenderFaceRange[] = [];
  for (const item of items.filter(isVideoItem).filter((candidate) => candidate.assetId === mediaId)) {
    for (const range of ranges) {
      const overlapStart = Math.max(range.startSec, item.trimInSec);
      const overlapEnd = Math.min(range.endSec, item.trimOutSec);
      if (overlapEnd <= overlapStart) continue;
      mapped.push({
        startSec: item.startSec + overlapStart - item.trimInSec,
        endSec: item.startSec + overlapEnd - item.trimInSec,
      });
    }
  }
  return normalizeRanges(mapped);
}

/** Merges overlapping/adjacent ranges (within a small epsilon) into a sorted,
 * non-overlapping set. Shared by tracked-segment bookkeeping and by mapping
 * coverage ranges into edit time. */
export function normalizeRanges<T extends { startSec: number; endSec: number }>(
  ranges: T[],
): { startSec: number; endSec: number }[] {
  const ADJACENCY_EPSILON_SEC = 1e-3;
  const sorted = ranges
    .filter((range) => Number.isFinite(range.startSec) && Number.isFinite(range.endSec) && range.endSec > range.startSec)
    .map((range) => ({ startSec: range.startSec, endSec: range.endSec }))
    .sort((a, b) => a.startSec - b.startSec);
  const merged: { startSec: number; endSec: number }[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.startSec <= last.endSec + ADJACENCY_EPSILON_SEC) {
      last.endSec = Math.max(last.endSec, range.endSec);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Which portions of `required` are not yet covered by `covered` -- i.e. what
 * still needs to be (re)tracked. Both inputs may be unmerged/unsorted. */
export function subtractRanges(
  required: { startSec: number; endSec: number }[],
  covered: { startSec: number; endSec: number }[],
): { startSec: number; endSec: number }[] {
  const mergedCovered = normalizeRanges(covered);
  const missing: { startSec: number; endSec: number }[] = [];
  for (const req of normalizeRanges(required)) {
    let cursor = req.startSec;
    for (const range of mergedCovered) {
      if (range.endSec <= cursor) continue;
      if (range.startSec >= req.endSec) break;
      if (range.startSec > cursor) missing.push({ startSec: cursor, endSec: Math.min(range.startSec, req.endSec) });
      cursor = Math.max(cursor, range.endSec);
      if (cursor >= req.endSec) break;
    }
    if (cursor < req.endSec) missing.push({ startSec: cursor, endSec: req.endSec });
  }
  return missing;
}

/** Sorts, drops non-finite entries, and collapses exact-duplicate timestamps
 * (last write wins) -- the shape a tracker's raw output should always be
 * reduced to before it's trusted anywhere else. */
export function normalizeFaceTrackPoints(points: FaceTrackPoint[]): FaceTrackPoint[] {
  const DUPLICATE_EPSILON_SEC = 1e-6;
  const sorted = points
    .filter((point) => Number.isFinite(point.timeSec) && Number.isFinite(point.centerX) && Number.isFinite(point.centerY))
    .sort((a, b) => a.timeSec - b.timeSec);
  const deduped: FaceTrackPoint[] = [];
  for (const point of sorted) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.timeSec - point.timeSec) < DUPLICATE_EPSILON_SEC) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }
  return deduped;
}

/** Reads a media's face track defensively -- missing entries, or ones that
 * fail structural validation (e.g. corrupted persisted JSON), are treated as
 * "nothing tracked yet" rather than trusted as-is or thrown on. */
export function readMediaFaceTrack(project: Project, mediaId: string): { points: FaceTrackPoint[]; segments: FaceTrackRange[] } {
  const entry: MediaFaceTrack | undefined = project.faceTracksByMediaId?.[mediaId];
  if (!entry || !Array.isArray(entry.points) || !Array.isArray(entry.segments)) {
    return { points: [], segments: [] };
  }
  return {
    points: normalizeFaceTrackPoints(entry.points),
    segments: normalizeRanges(entry.segments),
  };
}

const FACE_COVERAGE_EPSILON_SEC = 0.2; // generous vs. the ~0.17s gap at 6fps sampling

function isWithinFaceCoverage(coverage: RenderFaceRange[], t: number): boolean {
  return coverage.some((range) => t >= range.startSec - FACE_COVERAGE_EPSILON_SEC && t <= range.endSec + FACE_COVERAGE_EPSILON_SEC);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

/** The single interpolation implementation shared by the live preview and the
 * Remotion export -- both must agree on what a given point in time resolves
 * to. Returns null (never an unrelated clamped endpoint) whenever `t` falls
 * outside every covered range, including genuine gaps between two tracked
 * segments of the same media, so callers can fall back to a centered crop
 * instead of drifting toward a position that isn't actually this moment's. */
export function interpolateFacePoint(
  points: RenderFacePoint[],
  coverage: RenderFaceRange[],
  t: number,
): { centerX: number; centerY: number } | null {
  if (!points.length || !coverage.length) return null;
  if (!isWithinFaceCoverage(coverage, t)) return null;

  const sorted = [...points].sort((a, b) => a.editTimeSec - b.editTimeSec);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (t <= first.editTimeSec) return { centerX: clampUnit(first.centerX), centerY: clampUnit(first.centerY) };
  if (t >= last.editTimeSec) return { centerX: clampUnit(last.centerX), centerY: clampUnit(last.centerY) };

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.editTimeSec && t <= b.editTimeSec) {
      const span = b.editTimeSec - a.editTimeSec;
      const ratio = span > 0 ? (t - a.editTimeSec) / span : 0;
      return {
        centerX: clampUnit(a.centerX + (b.centerX - a.centerX) * ratio),
        centerY: clampUnit(a.centerY + (b.centerY - a.centerY) * ratio),
      };
    }
  }
  return { centerX: clampUnit(last.centerX), centerY: clampUnit(last.centerY) };
}

export function getAdaptiveTickInterval(pxPerSecond: number): number {
  const targetSeconds = 72 / Math.max(pxPerSecond, 0.01);
  const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900];
  return intervals.find((interval) => interval >= targetSeconds) ?? intervals[intervals.length - 1];
}

export function snapTime(value: number, candidates: number[], thresholdSec: number): number {
  let result = value;
  let distance = thresholdSec;
  for (const candidate of candidates) {
    const nextDistance = Math.abs(candidate - value);
    if (nextDistance <= distance) {
      result = candidate;
      distance = nextDistance;
    }
  }
  return result;
}

export function clampClipStart(item: TimelineItem, proposedStart: number, trackItems: TimelineItem[]): number {
  const duration = clipDuration(item);
  const others = trackItems.filter((candidate) => candidate.id !== item.id).sort((a, b) => a.startSec - b.startSec);
  let start = Math.max(0, proposedStart);
  for (const other of others) {
    const otherEnd = other.startSec + clipDuration(other);
    if (start < otherEnd && start + duration > other.startSec) {
      start = proposedStart >= item.startSec ? otherEnd : Math.max(0, other.startSec - duration);
    }
  }
  return start;
}

/** Schema v1 -> v2 migration: the old `Clip` shape (mediaId/inSec/outSec, no
 * durationSec) becomes a `VideoItem` (assetId/trimInSec/trimOutSec, explicit
 * durationSec). Every clip that ever existed before v2 was a video placement
 * -- v1's optional `kind` field was never populated with anything but "media"
 * in practice, so any non-"media" legacy value still migrates to a VideoItem
 * (the only shape v1's fields actually support) rather than being dropped. */
function migrateClipToTimelineItem(clip: Clip): VideoItem {
  return {
    id: clip.id,
    trackId: clip.trackId,
    kind: "video",
    assetId: clip.mediaId,
    trimInSec: clip.inSec,
    trimOutSec: clip.outSec,
    startSec: clip.startSec,
    durationSec: Math.max(0, clip.outSec - clip.inSec),
    transform: clip.transform as ItemTransform | undefined,
  };
}

function isLegacyClip(value: Clip | TimelineItem): value is Clip {
  return !("durationSec" in value);
}

function migrateTimelineItems(items: (Clip | TimelineItem)[] | undefined): TimelineItem[] {
  return (items ?? []).map((item) => (isLegacyClip(item) ? migrateClipToTimelineItem(item) : item));
}

export function normalizeProject(project: Project): Project {
  const faceTracksByMediaId = { ...(project.faceTracksByMediaId ?? {}) };
  if (!Object.keys(faceTracksByMediaId).length && project.faceTrack?.length && project.faceTrackMediaId) {
    const points = normalizeFaceTrackPoints(project.faceTrack);
    if (points.length) {
      // Legacy single-track projects never recorded explicit tracked-range
      // coverage -- approximate it as the span the points themselves cover so
      // migrated data still gets correct null-outside-range interpolation
      // rather than silently claiming coverage it never had.
      faceTracksByMediaId[project.faceTrackMediaId] = {
        points,
        segments: [{ startSec: points[0].timeSec, endSec: points[points.length - 1].timeSec }],
        updatedAt: project.updatedAt,
      };
    }
  }

  const tracks = (project.tracks ?? []).map((track, order) => ({ ...track, order: track.order ?? order }));
  // Phase 1 added an "elements" track (text cards, later shapes/stickers) --
  // any project created before that migrates in one here rather than ever
  // having text items with nowhere on the timeline to live.
  if (!tracks.some((track) => track.kind === "elements")) {
    tracks.push({ id: "elements", kind: "elements", name: "Elements", order: tracks.length });
  }

  return {
    ...project,
    schemaVersion: 2,
    media: (project.media ?? []).map((asset) => ({
      ...asset,
      provenance: asset.provenance ?? { sourceType: "upload" },
    })),
    tracks,
    clips: migrateTimelineItems(project.clips as unknown as (Clip | TimelineItem)[]),
    transcript: project.transcript ?? null,
    transcriptMediaId: project.transcriptMediaId ?? null,
    faceTrack: project.faceTrack ?? null,
    faceTrackMediaId: project.faceTrackMediaId ?? null,
    faceTracksByMediaId,
    aiGenerations: project.aiGenerations ?? [],
    sourceTimelineSnapshot: project.sourceTimelineSnapshot
      ? migrateTimelineItems(project.sourceTimelineSnapshot as unknown as (Clip | TimelineItem)[])
      : null,
  };
}
