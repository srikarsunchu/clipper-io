import assert from "node:assert/strict";
import test from "node:test";
import type { Clip, FaceTrackPoint, Project, TimelineItem, VideoItem } from "../shared/timeline.ts";
import type { RenderFacePoint, RenderFaceRange } from "../shared/render-contract.ts";
import {
  buildCaptionCues,
  buildRenderCues,
  buildSpeechIntervals,
  clampClipStart,
  findClipAtTime,
  getAdaptiveTickInterval,
  interpolateFacePoint,
  isAudioItem,
  isImageItem,
  isTextItem,
  isVideoItem,
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
  withAudioTrim,
  withItemDuration,
  withVideoTrim,
} from "../shared/timeline-math.ts";
import { buildRenderPlan } from "../shared/render-plan.ts";

function videoItem(partial: Partial<VideoItem> & Pick<VideoItem, "id" | "trackId" | "assetId" | "trimInSec" | "trimOutSec" | "startSec">): VideoItem {
  return { kind: "video", durationSec: partial.trimOutSec - partial.trimInSec, ...partial };
}

const clips: VideoItem[] = [
  videoItem({ id: "a", trackId: "video", assetId: "source", trimInSec: 10, trimOutSec: 20, startSec: 0 }),
  videoItem({ id: "b", trackId: "video", assetId: "source", trimInSec: 30, trimOutSec: 36, startSec: 12 }),
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

const legacyClips: Clip[] = [
  { id: "a", trackId: "video", mediaId: "source", inSec: 10, outSec: 20, startSec: 0 },
  { id: "b", trackId: "video", mediaId: "source", inSec: 30, outSec: 36, startSec: 12, kind: "media" },
];

test("normalizes legacy v1 projects (Clip[]) into v2 (TimelineItem[]) without destroying data", () => {
  const legacy = {
    id: "project",
    name: "Legacy",
    createdAt: "now",
    updatedAt: "now",
    media: [],
    tracks: [{ id: "video", kind: "video", name: "Video", order: 0 }],
    clips: legacyClips,
  } as unknown as Project;
  const normalized = normalizeProject(legacy);
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.transcript, null);
  assert.equal(normalized.faceTrack, null);

  // Every pre-v2 clip was a video placement -- migration must turn it into an
  // equivalent VideoItem, not drop or reinterpret its trim/position data.
  assert.equal(normalized.clips.length, 2);
  const [first, second] = normalized.clips;
  assert.ok(isVideoItem(first) && isVideoItem(second));
  assert.equal(first.kind, "video");
  assert.equal(first.assetId, "source");
  assert.equal(first.trimInSec, 10);
  assert.equal(first.trimOutSec, 20);
  assert.equal(first.startSec, 0);
  assert.equal(first.durationSec, 10);
  assert.equal(second.trimInSec, 30);
  assert.equal(second.trimOutSec, 36);
  assert.equal(second.durationSec, 6);
});

test("normalizeProject leaves already-migrated v2 TimelineItems untouched (idempotent)", () => {
  const v2Project = {
    id: "project",
    name: "Modern",
    createdAt: "now",
    updatedAt: "now",
    media: [],
    tracks: [{ id: "video", kind: "video", name: "Video", order: 0 }],
    clips,
  } as unknown as Project;
  const normalized = normalizeProject(v2Project);
  assert.equal(normalized.schemaVersion, 2);
  assert.deepEqual(normalized.clips, clips);
});

test("normalizeProject defaults every media asset's provenance to upload when absent", () => {
  const legacy = {
    id: "project",
    name: "Legacy",
    createdAt: "now",
    updatedAt: "now",
    media: [{ id: "m1", fileName: "a.mp4", mimeType: "video/mp4", durationSec: 10, width: 1920, height: 1080, fps: 30, hasAudio: true, createdAt: "now" }],
    tracks: [],
    clips: [],
  } as unknown as Project;
  const normalized = normalizeProject(legacy);
  assert.deepEqual(normalized.media[0].provenance, { sourceType: "upload" });
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
  const multiMediaClips: VideoItem[] = [
    videoItem({ id: "a", trackId: "video", assetId: "mediaA", trimInSec: 0, trimOutSec: 10, startSec: 0 }),
    videoItem({ id: "b", trackId: "video", assetId: "mediaB", trimInSec: 20, trimOutSec: 30, startSec: 10 }), // does not cover timeSec=5
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

test("buildSpeechIntervals merges words separated by short gaps, splits on long pauses", () => {
  const intervals = buildSpeechIntervals([
    { word: "hey", start: 0, end: 0.4 },
    { word: "there", start: 0.5, end: 0.9 }, // 0.1s gap -- same interval
    { word: "friend", start: 2.0, end: 2.5 }, // 1.1s gap -- new interval
  ]);
  assert.deepEqual(intervals, [
    { start: 0, end: 0.9 },
    { start: 2.0, end: 2.5 },
  ]);
});

test("buildSpeechIntervals is not capped by word count/char length the way buildCaptionCues is", () => {
  const words = Array.from({ length: 20 }, (_, i) => ({ word: "word", start: i * 0.3, end: i * 0.3 + 0.25 }));
  const intervals = buildSpeechIntervals(words);
  assert.equal(intervals.length, 1); // one continuous speech run, not split into caption-sized chunks
  assert.equal(intervals[0].start, 0);
  assert.equal(intervals[0].end, 19 * 0.3 + 0.25);
});

test("buildSpeechIntervals returns nothing for an empty transcript", () => {
  assert.deepEqual(buildSpeechIntervals([]), []);
});

test("withVideoTrim keeps durationSec in sync with the new trim points", () => {
  const item = videoItem({ id: "a", trackId: "video", assetId: "source", trimInSec: 10, trimOutSec: 20, startSec: 0 });
  const trimmed = withVideoTrim(item, 12, 18);
  assert.equal(trimmed.trimInSec, 12);
  assert.equal(trimmed.trimOutSec, 18);
  assert.equal(trimmed.durationSec, 6);
});

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: "now",
    updatedAt: "now",
    media: [],
    tracks: [
      { id: "video", kind: "video", name: "Video", order: 0 },
      { id: "caption", kind: "caption", name: "Captions", order: 1 },
    ],
    clips: [],
    transcript: null,
    transcriptMediaId: null,
    faceTrack: null,
    faceTrackMediaId: null,
    ...overrides,
  } as Project;
}

test("buildRenderPlan is deterministic: identical project input produces an identical plan hash", () => {
  const project = baseProject({
    clips: [videoItem({ id: "a", trackId: "video", assetId: "m1", trimInSec: 0, trimOutSec: 5, startSec: 0 })],
    media: [{ id: "m1", fileName: "a.mp4", mimeType: "video/mp4", durationSec: 5, width: 1920, height: 1080, fps: 30, hasAudio: true, createdAt: "now" }],
  });
  const resolve = (id: string) => `https://cdn.example/${id}`;
  const planA = buildRenderPlan(project, resolve);
  const planB = buildRenderPlan(project, resolve);
  assert.equal(planA.planHash, planB.planHash);
  assert.deepEqual(planA, planB);
});

test("buildRenderPlan produces a different hash when the project content actually differs", () => {
  const project = baseProject({
    clips: [videoItem({ id: "a", trackId: "video", assetId: "m1", trimInSec: 0, trimOutSec: 5, startSec: 0 })],
    media: [{ id: "m1", fileName: "a.mp4", mimeType: "video/mp4", durationSec: 5, width: 1920, height: 1080, fps: 30, hasAudio: true, createdAt: "now" }],
    // A caption style only manifests in the plan if there's actually a
    // captions layer for it to apply to.
    transcript: [{ word: "hi", start: 0, end: 1 }],
    transcriptMediaId: "m1",
  });
  const resolve = (id: string) => `https://cdn.example/${id}`;
  const planA = buildRenderPlan(project, resolve, { captionStyle: "pop" });
  const planB = buildRenderPlan(project, resolve, { captionStyle: "clean" });
  assert.notEqual(planA.planHash, planB.planHash);
});

test("buildRenderPlan scopes each video layer's face-track data to its own media, never another layer's", () => {
  const project = baseProject({
    clips: [
      videoItem({ id: "a", trackId: "video", assetId: "m1", trimInSec: 0, trimOutSec: 5, startSec: 0 }),
      videoItem({ id: "b", trackId: "video", assetId: "m2", trimInSec: 0, trimOutSec: 5, startSec: 5 }),
    ],
    media: [
      { id: "m1", fileName: "a.mp4", mimeType: "video/mp4", durationSec: 5, width: 1920, height: 1080, fps: 30, hasAudio: true, createdAt: "now" },
      { id: "m2", fileName: "b.mp4", mimeType: "video/mp4", durationSec: 5, width: 1920, height: 1080, fps: 30, hasAudio: true, createdAt: "now" },
    ],
    faceTracksByMediaId: {
      m1: { points: [{ timeSec: 2, centerX: 0.1, centerY: 0.1 }], segments: [{ startSec: 0, endSec: 5 }], updatedAt: "now" },
      // m2 has no tracking data at all
    },
  });
  const plan = buildRenderPlan(project, (id) => `https://cdn.example/${id}`);
  const videoLayers = plan.layers.filter((layer) => layer.kind === "video");
  assert.equal(videoLayers.length, 2);
  const [layerA, layerB] = videoLayers;
  assert.equal(layerA.facePoints.length, 1);
  assert.equal(layerA.faceCoverage.length, 1);
  // m2's layer must never inherit m1's points just because they're both in the plan.
  assert.equal(layerB.facePoints.length, 0);
  assert.equal(layerB.faceCoverage.length, 0);
});

test("buildRenderPlan resolves asset URLs through the injected resolver, not a hardcoded scheme", () => {
  const project = baseProject({
    clips: [videoItem({ id: "a", trackId: "video", assetId: "m1", trimInSec: 0, trimOutSec: 5, startSec: 0 })],
    media: [{ id: "m1", fileName: "a.mp4", mimeType: "video/mp4", durationSec: 5, width: 1920, height: 1080, fps: 30, hasAudio: true, createdAt: "now" }],
  });
  const plan = buildRenderPlan(project, (id) => `s3://bucket/${id}.mp4`);
  const [layer] = plan.layers;
  assert.equal(layer.kind, "video");
  assert.equal((layer as { src: string }).src, "s3://bucket/m1.mp4");
});

test("buildRenderPlan resolves a video layer's manualScale from the item's transform, defaulting to 1", () => {
  const project = baseProject({
    clips: [
      videoItem({ id: "a", trackId: "video", assetId: "m1", trimInSec: 0, trimOutSec: 5, startSec: 0 }),
      { ...videoItem({ id: "b", trackId: "video", assetId: "m1", trimInSec: 5, trimOutSec: 10, startSec: 5 }), transform: { scale: 1.3, x: 0, y: 0 } },
    ],
    media: [{ id: "m1", fileName: "a.mp4", mimeType: "video/mp4", durationSec: 10, width: 1920, height: 1080, fps: 30, hasAudio: true, createdAt: "now" }],
  });
  const plan = buildRenderPlan(project, (id) => `https://cdn.example/${id}`);
  const videoLayers = plan.layers.filter((layer) => layer.kind === "video");
  assert.equal(videoLayers[0].manualScale, 1);
  assert.equal(videoLayers[1].manualScale, 1.3);
});

test("buildRenderPlan builds image/text/audio layers with sensible defaults", () => {
  const project = baseProject({
    tracks: [
      { id: "video", kind: "video", name: "Video", order: 0 },
      { id: "broll", kind: "broll", name: "B-roll", order: 1 },
      { id: "audio", kind: "audio", name: "Audio", order: 2 },
    ],
    clips: [
      { id: "img", trackId: "broll", kind: "image", assetId: "m2", startSec: 0, durationSec: 3 },
      { id: "txt", trackId: "broll", kind: "text", text: "Hello", startSec: 0, durationSec: 3 },
      { id: "aud", trackId: "audio", kind: "audio", assetId: "m3", startSec: 0, durationSec: 3, trimInSec: 0, trimOutSec: 3 },
    ] as unknown as TimelineItem[],
    media: [
      { id: "m2", fileName: "b.jpg", mimeType: "image/jpeg", durationSec: 5, width: 800, height: 600, fps: 0, hasAudio: false, createdAt: "now" },
      { id: "m3", fileName: "c.mp3", mimeType: "audio/mpeg", durationSec: 3, width: 0, height: 0, fps: 0, hasAudio: true, createdAt: "now" },
    ],
  });
  const plan = buildRenderPlan(project, (id) => `https://cdn.example/${id}`);
  const kinds = plan.layers.map((layer) => layer.kind);
  assert.deepEqual(kinds, ["image", "text", "audio"]);
  const imageLayer = plan.layers[0];
  assert.equal(imageLayer.kind, "image");
  assert.equal((imageLayer as { motionPreset: string }).motionPreset, "none");
  const textLayer = plan.layers[1];
  assert.equal(textLayer.kind, "text");
  assert.equal((textLayer as { text: string }).text, "Hello");
  assert.equal((textLayer as { alignment: string }).alignment, "center");
  const audioLayer = plan.layers[2];
  assert.equal(audioLayer.kind, "audio");
  assert.equal((audioLayer as { volume: number }).volume, 1);
});

test("buildRenderPlan flattens a group's children with group-local time offset and composes its transform", () => {
  const project = baseProject({
    tracks: [{ id: "elements", kind: "elements", name: "Elements", order: 0 }],
    clips: [
      {
        id: "grp",
        trackId: "elements",
        kind: "group",
        startSec: 10,
        durationSec: 4,
        transform: { scale: 1.2, x: 5, y: -5 },
        children: [
          { id: "child-text", trackId: "elements", kind: "text", text: "Hi", startSec: 1, durationSec: 2 },
          { id: "child-overlay", trackId: "elements", kind: "htmlOverlay", template: "priceBadge", startSec: 0, durationSec: 4, props: { newPrice: "$9" } },
        ],
      },
    ] as unknown as TimelineItem[],
  });
  const plan = buildRenderPlan(project, (id) => `https://cdn.example/${id}`);
  assert.equal(plan.layers.length, 1);
  const group = plan.layers[0];
  assert.equal(group.kind, "group");
  if (group.kind !== "group") throw new Error("unreachable");
  assert.equal(group.sequenceStartSec, 10);
  assert.equal(group.transform.scale, 1.2);
  assert.equal(group.transform.x, 5);
  assert.equal(group.children.length, 2);
  const [childText, childOverlay] = group.children;
  assert.equal(childText.kind, "text");
  // child startSec (1) is group-local -- flattened to an edit-time-absolute
  // sequenceStartSec of groupStart (10) + childStart (1).
  assert.equal((childText as { sequenceStartSec: number }).sequenceStartSec, 11);
  assert.equal(childOverlay.kind, "htmlOverlay");
  assert.equal((childOverlay as { sequenceStartSec: number }).sequenceStartSec, 10);
  assert.equal((childOverlay as { template: string }).template, "priceBadge");
  assert.deepEqual((childOverlay as { props: Record<string, unknown> }).props, { newPrice: "$9" });
});

test("buildRenderPlan builds an htmlOverlay layer at the top level with default props", () => {
  const project = baseProject({
    tracks: [{ id: "elements", kind: "elements", name: "Elements", order: 0 }],
    clips: [
      { id: "overlay", trackId: "elements", kind: "htmlOverlay", template: "phoneNotification", startSec: 2, durationSec: 3 },
    ] as unknown as TimelineItem[],
  });
  const plan = buildRenderPlan(project, (id) => `https://cdn.example/${id}`);
  assert.equal(plan.layers.length, 1);
  const layer = plan.layers[0];
  assert.equal(layer.kind, "htmlOverlay");
  if (layer.kind !== "htmlOverlay") throw new Error("unreachable");
  assert.equal(layer.sequenceStartSec, 2);
  assert.equal(layer.template, "phoneNotification");
  assert.deepEqual(layer.props, {});
});

test("buildRenderPlan applies a caption accentOverride without changing the preset's other fields", () => {
  const project = baseProject({
    clips: [videoItem({ id: "a", trackId: "video", assetId: "m1", trimInSec: 0, trimOutSec: 5, startSec: 0 })],
    media: [{ id: "m1", fileName: "a.mp4", mimeType: "video/mp4", durationSec: 5, width: 1920, height: 1080, fps: 30, hasAudio: true, createdAt: "now" }],
    transcript: [{ word: "hi", start: 0, end: 1 }],
    transcriptMediaId: "m1",
  });
  const plan = buildRenderPlan(project, (id) => `https://cdn.example/${id}`, { captionAccentOverride: "#00ff00" });
  const captionsLayer = plan.layers[plan.layers.length - 1];
  assert.equal(captionsLayer.kind, "captions");
  if (captionsLayer.kind !== "captions") throw new Error("unreachable");
  assert.equal(captionsLayer.accentOverride, "#00ff00");
});

test("buildRenderPlan appends a captions layer last (paints on top) when a transcript exists for the tracked media", () => {
  const project = baseProject({
    clips: [videoItem({ id: "a", trackId: "video", assetId: "m1", trimInSec: 0, trimOutSec: 5, startSec: 0 })],
    media: [{ id: "m1", fileName: "a.mp4", mimeType: "video/mp4", durationSec: 5, width: 1920, height: 1080, fps: 30, hasAudio: true, createdAt: "now" }],
    transcript: [{ word: "hi", start: 0, end: 1 }],
    transcriptMediaId: "m1",
  });
  const plan = buildRenderPlan(project, (id) => `https://cdn.example/${id}`);
  assert.equal(plan.layers[plan.layers.length - 1].kind, "captions");
});

test("normalizeProject migrates in a missing elements track (Phase 1) without disturbing existing tracks", () => {
  const project = baseProject(); // baseProject's fixture tracks predate the elements track
  const normalized = normalizeProject(project);
  assert.equal(normalized.tracks.length, 3);
  assert.equal(normalized.tracks[0].kind, "video");
  assert.equal(normalized.tracks[1].kind, "caption");
  assert.equal(normalized.tracks[2].kind, "elements");
});

test("normalizeProject does not duplicate an elements track that already exists", () => {
  const project = baseProject({
    tracks: [
      { id: "video", kind: "video", name: "Video", order: 0 },
      { id: "els", kind: "elements", name: "Elements", order: 1 },
    ],
  });
  const normalized = normalizeProject(project);
  assert.equal(normalized.tracks.filter((track) => track.kind === "elements").length, 1);
  assert.equal(normalized.tracks.find((track) => track.kind === "elements")?.id, "els");
});

test("kind type guards only match their own item kind", () => {
  const image = { id: "i", trackId: "t", kind: "image", assetId: "m", startSec: 0, durationSec: 5 } as const;
  const text = { id: "x", trackId: "t", kind: "text", text: "hi", startSec: 0, durationSec: 5 } as const;
  const audio = { id: "a", trackId: "t", kind: "audio", assetId: "m", trimInSec: 0, trimOutSec: 5, startSec: 0, durationSec: 5 } as const;
  assert.ok(isImageItem(image) && !isTextItem(image) && !isAudioItem(image));
  assert.ok(isTextItem(text) && !isImageItem(text) && !isAudioItem(text));
  assert.ok(isAudioItem(audio) && !isImageItem(audio) && !isTextItem(audio));
});

test("withAudioTrim keeps durationSec in sync with the trim window, like withVideoTrim", () => {
  const audio = { id: "a", trackId: "t", kind: "audio" as const, assetId: "m", trimInSec: 2, trimOutSec: 5, startSec: 0, durationSec: 3 };
  const trimmed = withAudioTrim(audio, 2, 8);
  assert.equal(trimmed.durationSec, 6);
  assert.equal(trimmed.trimInSec, 2);
  assert.equal(trimmed.trimOutSec, 8);
});

test("withItemDuration sets an image/text item's duration directly, floored at 0.1s", () => {
  const image = { id: "i", trackId: "t", kind: "image" as const, assetId: "m", startSec: 0, durationSec: 5 };
  assert.equal(withItemDuration(image, 8).durationSec, 8);
  assert.equal(withItemDuration(image, -3).durationSec, 0.1);
});
