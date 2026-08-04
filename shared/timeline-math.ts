import type { Clip, FaceTrackPoint, FaceTrackRange, MediaFaceTrack, Project, TranscriptWord } from "./timeline";
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

export function clipDuration(clip: Clip): number {
  return Math.max(0, clip.outSec - clip.inSec);
}

export function timelineDuration(clips: Clip[]): number {
  return clips.reduce((duration, clip) => Math.max(duration, clip.startSec + clipDuration(clip)), 0);
}

export function findClipAtTime(clips: Clip[], time: number): Clip | null {
  if (!clips.length) return null;
  return clips.find((clip) => time >= clip.startSec && time < clip.startSec + clipDuration(clip)) ?? null;
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
  clips: Clip[],
  transcriptMediaId: string | null,
): EditCaptionCue[] {
  if (!transcriptMediaId) return [];
  const mapped: EditCaptionCue[] = [];
  for (const clip of clips.filter((candidate) => candidate.mediaId === transcriptMediaId)) {
    for (const cue of cues) {
      const overlapStart = Math.max(cue.start, clip.inSec);
      const overlapEnd = Math.min(cue.end, clip.outSec);
      if (overlapEnd <= overlapStart) continue;
      mapped.push({
        ...cue,
        editStart: clip.startSec + overlapStart - clip.inSec,
        editEnd: clip.startSec + overlapEnd - clip.inSec,
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
 * given clips reference that exact media -- clips for any other media are
 * ignored, so a caller can never accidentally get media A's points back out
 * under media B's identity by passing the wrong clip list. */
export function mapFaceTrackToEditTime(points: FaceTrackPoint[], clips: Clip[], mediaId: string): RenderFacePoint[] {
  const mapped: RenderFacePoint[] = [];
  for (const clip of clips.filter((candidate) => candidate.mediaId === mediaId)) {
    for (const point of points) {
      if (point.timeSec < clip.inSec || point.timeSec > clip.outSec) continue;
      mapped.push({
        editTimeSec: clip.startSec + point.timeSec - clip.inSec,
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
export function mapFaceRangesToEditTime(ranges: FaceTrackRange[], clips: Clip[], mediaId: string): RenderFaceRange[] {
  const mapped: RenderFaceRange[] = [];
  for (const clip of clips.filter((candidate) => candidate.mediaId === mediaId)) {
    for (const range of ranges) {
      const overlapStart = Math.max(range.startSec, clip.inSec);
      const overlapEnd = Math.min(range.endSec, clip.outSec);
      if (overlapEnd <= overlapStart) continue;
      mapped.push({
        startSec: clip.startSec + overlapStart - clip.inSec,
        endSec: clip.startSec + overlapEnd - clip.inSec,
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

export function clampClipStart(clip: Clip, proposedStart: number, trackClips: Clip[]): number {
  const duration = clipDuration(clip);
  const others = trackClips.filter((candidate) => candidate.id !== clip.id).sort((a, b) => a.startSec - b.startSec);
  let start = Math.max(0, proposedStart);
  for (const other of others) {
    const otherEnd = other.startSec + clipDuration(other);
    if (start < otherEnd && start + duration > other.startSec) {
      start = proposedStart >= clip.startSec ? otherEnd : Math.max(0, other.startSec - duration);
    }
  }
  return start;
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

  return {
    ...project,
    schemaVersion: project.schemaVersion ?? 1,
    media: project.media ?? [],
    tracks: (project.tracks ?? []).map((track, order) => ({ ...track, order: track.order ?? order })),
    clips: (project.clips ?? []).map((clip) => ({ ...clip, kind: clip.kind ?? "media" })),
    transcript: project.transcript ?? null,
    transcriptMediaId: project.transcriptMediaId ?? null,
    faceTrack: project.faceTrack ?? null,
    faceTrackMediaId: project.faceTrackMediaId ?? null,
    faceTracksByMediaId,
    aiGenerations: project.aiGenerations ?? [],
    sourceTimelineSnapshot: project.sourceTimelineSnapshot
      ? project.sourceTimelineSnapshot.map((clip) => ({ ...clip, kind: clip.kind ?? "media" }))
      : null,
  };
}
