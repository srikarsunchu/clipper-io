import assert from "node:assert/strict";
import test from "node:test";
import type { Clip, FaceTrackPoint, Project } from "../shared/timeline.ts";
import type { RenderFacePoint, RenderFaceRange } from "../shared/render-contract.ts";
import {
  buildCaptionCues,
  buildRenderCues,
  clampClipStart,
  findClipAtTime,
  getAdaptiveTickInterval,
  interpolateFacePoint,
  mapCuesToEditTime,
  mapFaceRangesToEditTime,
  mapFaceTrackToEditTime,
  normalizeFaceTrackPoints,
  normalizeProject,
  normalizeRanges,
  readMediaFaceTrack,
  snapTime,
  subtractRanges,
  timelineDuration,
} from "../shared/timeline-math.ts";

const clips: Clip[] = [
  { id: "a", trackId: "video", mediaId: "source", inSec: 10, outSec: 20, startSec: 0 },
  { id: "b", trackId: "video", mediaId: "source", inSec: 30, outSec: 36, startSec: 12 },
];

test("maps source captions into edit time across trimmed clips", () => {
  const cues = buildCaptionCues([
    { word: "start", start: 10, end: 11 },
    { word: "here", start: 11.1, end: 12 },
    { word: "again", start: 30, end: 31 },
  ]);
  const mapped = mapCuesToEditTime(cues, clips, "source");
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].editStart, 0);
  assert.equal(mapped[1].editStart, 12);
  assert.deepEqual(buildRenderCues(mapped)[1].words[0], { word: "again", editStart: 12, editEnd: 13 });
});

test("finds clips and computes duration from placed items", () => {
  assert.equal(findClipAtTime(clips, 2)?.id, "a");
  assert.equal(findClipAtTime(clips, 11), null);
  assert.equal(timelineDuration(clips), 18);
});

test("snaps and prevents same-track overlap", () => {
  assert.equal(snapTime(9.96, [0, 10, 20], 0.1), 10);
  assert.equal(clampClipStart(clips[1], 8, clips), 0);
  assert.equal(clampClipStart(clips[1], 20, clips), 20);
});

test("uses readable ruler intervals at different zoom levels", () => {
  assert.equal(getAdaptiveTickInterval(24), 5);
  assert.equal(getAdaptiveTickInterval(4), 30);
  assert.equal(getAdaptiveTickInterval(0.5), 300);
});

test("normalizes legacy projects without destroying data", () => {
  const legacy = {
    id: "project",
    name: "Legacy",
    createdAt: "now",
    updatedAt: "now",
    media: [],
    tracks: [{ id: "video", kind: "video", name: "Video", order: 0 }],
    clips,
  } as unknown as Project;
  const normalized = normalizeProject(legacy);
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.clips[0].kind, "media");
  assert.equal(normalized.transcript, null);
  assert.equal(normalized.faceTrack, null);
});

test("migrates a legacy single-track project into faceTracksByMediaId with derived coverage", () => {
  const legacy = {
    id: "project",
    name: "Legacy",
    createdAt: "now",
    updatedAt: "2024-01-01T00:00:00.000Z",
    media: [],
    tracks: [],
    clips: [],
    faceTrack: [
      { timeSec: 10, centerX: 0.4, centerY: 0.5 },
      { timeSec: 15, centerX: 0.6, centerY: 0.5 },
    ],
    faceTrackMediaId: "source",
  } as unknown as Project;
  const normalized = normalizeProject(legacy);
  const migrated = normalized.faceTracksByMediaId?.["source"];
  assert.ok(migrated);
  assert.equal(migrated!.points.length, 2);
  // Legacy data never recorded explicit coverage -- it's approximated as the
  // span the points themselves cover, not "the whole media."
  assert.deepEqual(migrated!.segments, [{ startSec: 10, endSec: 15 }]);
});

test("normalizeProject is idempotent once faceTracksByMediaId already exists", () => {
  const project = {
    id: "project",
    name: "Modern",
    createdAt: "now",
    updatedAt: "now",
    media: [],
    tracks: [],
    clips: [],
    faceTrack: null,
    faceTrackMediaId: null,
    faceTracksByMediaId: {
      mediaA: { points: [{ timeSec: 1, centerX: 0.1, centerY: 0.1 }], segments: [{ startSec: 0, endSec: 2 }], updatedAt: "now" },
    },
  } as unknown as Project;
  const normalized = normalizeProject(project);
  assert.equal(Object.keys(normalized.faceTracksByMediaId ?? {}).length, 1);
  assert.equal(normalized.faceTracksByMediaId!["mediaA"].points.length, 1);
});

test("mapFaceTrackToEditTime only maps through clips belonging to the requested mediaId, even if other media's clips are in the same array", () => {
  // `points` is the caller's responsibility to source from one specific
  // media's stored track (enforced structurally by the per-media storage
  // model) -- what this function itself guarantees is that it only ever
  // consults clips for the mediaId it was asked about, never clips for a
  // different media that happen to be in the same array.
  const points: FaceTrackPoint[] = [{ timeSec: 5, centerX: 0.3, centerY: 0.3 }];
  const multiMediaClips: Clip[] = [
    { id: "a", trackId: "video", mediaId: "mediaA", inSec: 0, outSec: 10, startSec: 0 },
    { id: "b", trackId: "video", mediaId: "mediaB", inSec: 20, outSec: 30, startSec: 10 }, // does not cover timeSec=5
  ];
  const mappedForB = mapFaceTrackToEditTime(points, multiMediaClips, "mediaB");
  assert.equal(mappedForB.length, 0, "mediaB's own clip doesn't cover this timestamp, so nothing should map even though mediaA's clip would");

  const mappedForA = mapFaceTrackToEditTime(points, multiMediaClips, "mediaA");
  assert.equal(mappedForA.length, 1);
  assert.equal(mappedForA[0].editTimeSec, 5);
});

test("mapFaceTrackToEditTime handles the same media placed across multiple trimmed clips", () => {
  const points: FaceTrackPoint[] = [
    { timeSec: 12, centerX: 0.2, centerY: 0.2 },
    { timeSec: 32, centerX: 0.8, centerY: 0.8 },
  ];
  const mapped = mapFaceTrackToEditTime(points, clips, "source");
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].editTimeSec, 2); // clip a: startSec 0 + (12 - inSec 10)
  assert.equal(mapped[1].editTimeSec, 14); // clip b: startSec 12 + (32 - inSec 30)
});

test("normalizeRanges merges overlapping and adjacent ranges, drops invalid ones", () => {
  const merged = normalizeRanges([
    { startSec: 10, endSec: 20 },
    { startSec: 19.999, endSec: 25 }, // overlaps
    { startSec: 25, endSec: 30 }, // exactly adjacent
    { startSec: 5, endSec: 5 }, // zero-length, invalid
    { startSec: 50, endSec: 40 }, // reversed, invalid
  ]);
  assert.deepEqual(merged, [{ startSec: 10, endSec: 30 }]);
});

test("subtractRanges reports only the portions of required coverage that are missing", () => {
  const required = [{ startSec: 0, endSec: 100 }];
  const covered = [
    { startSec: 10, endSec: 30 },
    { startSec: 60, endSec: 70 },
  ];
  const missing = subtractRanges(required, covered);
  assert.deepEqual(missing, [
    { startSec: 0, endSec: 10 },
    { startSec: 30, endSec: 60 },
    { startSec: 70, endSec: 100 },
  ]);
});

test("subtractRanges returns nothing when required is already fully covered", () => {
  const required = [{ startSec: 10, endSec: 20 }];
  const covered = [{ startSec: 0, endSec: 100 }];
  assert.deepEqual(subtractRanges(required, covered), []);
});

test("normalizeFaceTrackPoints sorts, drops non-finite entries, and lets the last write win on exact-duplicate timestamps", () => {
  const points = normalizeFaceTrackPoints([
    { timeSec: 5, centerX: 0.9, centerY: 0.9 },
    { timeSec: 1, centerX: 0.1, centerY: 0.1 },
    { timeSec: 5, centerX: 0.2, centerY: 0.2 }, // duplicate of the first -- should win
    { timeSec: Number.NaN, centerX: 0.5, centerY: 0.5 },
  ]);
  assert.equal(points.length, 2);
  assert.equal(points[0].timeSec, 1);
  assert.equal(points[1].timeSec, 5);
  assert.equal(points[1].centerX, 0.2);
});

test("readMediaFaceTrack treats missing or structurally invalid entries as empty rather than throwing", () => {
  const projectWithNoTrack = { faceTracksByMediaId: {} } as unknown as Project;
  assert.deepEqual(readMediaFaceTrack(projectWithNoTrack, "mediaA"), { points: [], segments: [] });

  const projectWithCorruptTrack = {
    faceTracksByMediaId: { mediaA: { points: "not-an-array", segments: [] } },
  } as unknown as Project;
  assert.deepEqual(readMediaFaceTrack(projectWithCorruptTrack, "mediaA"), { points: [], segments: [] });
});

test("interpolateFacePoint returns null for empty points, empty coverage, and gaps between tracked segments", () => {
  assert.equal(interpolateFacePoint([], [], 5), null);

  const points: RenderFacePoint[] = [
    { editTimeSec: 0, centerX: 0.2, centerY: 0.2 },
    { editTimeSec: 5, centerX: 0.3, centerY: 0.3 },
    { editTimeSec: 20, centerX: 0.8, centerY: 0.8 },
    { editTimeSec: 25, centerX: 0.9, centerY: 0.9 },
  ];
  // Two disjoint tracked ranges within the same media, e.g. two separately-
  // tracked moments with an untracked gap between them.
  const coverage: RenderFaceRange[] = [
    { startSec: 0, endSec: 5 },
    { startSec: 20, endSec: 25 },
  ];
  assert.equal(interpolateFacePoint(points, coverage, 2.5)?.centerX, 0.25); // inside first range: interpolates normally
  assert.equal(interpolateFacePoint(points, coverage, 12), null); // inside the untracked gap -- must not interpolate between unrelated segments
  assert.ok(interpolateFacePoint(points, coverage, 22) !== null); // inside second range
});

test("mapFaceRangesToEditTime maps and merges tracked-range coverage the same way mapFaceTrackToEditTime maps points", () => {
  const ranges = [{ startSec: 10, endSec: 15 }, { startSec: 30, endSec: 34 }];
  const mapped = mapFaceRangesToEditTime(ranges, clips, "source");
  assert.deepEqual(mapped, [
    { startSec: 0, endSec: 5 }, // clip a: 0 + (10..15 - inSec 10)
    { startSec: 12, endSec: 16 }, // clip b: 12 + (30..34 - inSec 30)
  ]);
});

test("interpolateFacePoint clamps output into [0,1] and is deterministic on duplicate timestamps", () => {
  const points: RenderFacePoint[] = [
    { editTimeSec: 0, centerX: 1.4, centerY: -0.2 },
    { editTimeSec: 1, centerX: 1.4, centerY: -0.2 }, // duplicate timestamp with the same values
  ];
  const coverage: RenderFaceRange[] = [{ startSec: 0, endSec: 1 }];
  const result = interpolateFacePoint(points, coverage, 0.5);
  assert.ok(result);
  assert.equal(result!.centerX, 1);
  assert.equal(result!.centerY, 0);
});
