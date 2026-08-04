import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");
let importCounter = 0;

// faceTrack.ts reads FACETRACK_PYTHON_BIN into a module-level const at import
// time, so each scenario needs the env var set *before* a fresh module
// evaluation -- a cache-busting query param forces Node to re-evaluate the
// module rather than reuse an already-imported instance with a stale binding.
async function importFaceTrackWithFakePython(fixtureName: string) {
  process.env.FACETRACK_PYTHON_BIN = path.join(FIXTURES_DIR, fixtureName);
  importCounter += 1;
  const moduleUrl = new URL("../src/faceTrack.ts", import.meta.url);
  moduleUrl.searchParams.set("t", String(importCounter));
  return import(moduleUrl.href) as Promise<typeof import("../src/faceTrack.ts")>;
}

test("missing python interpreter produces a clear setup error, not a raw ENOENT", async () => {
  process.env.FACETRACK_PYTHON_BIN = "/nonexistent/fake-python-binary";
  importCounter += 1;
  const moduleUrl = new URL("../src/faceTrack.ts", import.meta.url);
  moduleUrl.searchParams.set("t", String(importCounter));
  const { trackFaces } = (await import(moduleUrl.href)) as typeof import("../src/faceTrack.ts");
  await assert.rejects(() => trackFaces("/some/video.mp4", 0, 1), /not set up/i);
});

test("invalid JSON from the tracker produces a clear error", async () => {
  const { trackFaces } = await importFaceTrackWithFakePython("fake-echo-garbage.sh");
  await assert.rejects(() => trackFaces("/some/video.mp4", 0, 1), /invalid JSON/i);
});

test("a hung tracker is killed after the timeout instead of hanging the request", async () => {
  const { trackFaces } = await importFaceTrackWithFakePython("fake-sleep.sh");
  await assert.rejects(() => trackFaces("/some/video.mp4", 0, 1, { timeoutMs: 200 }), /timed out/i);
});

test("a non-zero exit surfaces the tracker's own stderr without a raw stack trace", async () => {
  const { trackFaces } = await importFaceTrackWithFakePython("fake-exit1.sh");
  await assert.rejects(() => trackFaces("/some/video.mp4", 0, 1), /diagnostic on stderr/i);
});

test("tracker output is validated and normalized: malformed points dropped, coords clamped, sorted+deduped", async () => {
  const { trackFaces } = await importFaceTrackWithFakePython("fake-echo-mixed-points.sh");
  const points = await trackFaces("/some/video.mp4", 0, 1);

  // The malformed entry (missing centerY) must be dropped, not passed through.
  assert.equal(points.length, 2);
  // Sorted by timeSec ascending.
  assert.ok(points[0].timeSec <= points[1].timeSec);
  // The duplicate timeSec=1.0 entries collapse to one (last write wins).
  assert.equal(points.filter((p) => p.timeSec === 1.0).length, 1);
  const dupPoint = points.find((p) => p.timeSec === 1.0)!;
  assert.equal(dupPoint.centerX, 0.4);
  assert.equal(dupPoint.centerY, 0.6);
  // Every coordinate is clamped into [0,1], even though the raw output had
  // centerX=1.2 and centerY=-0.3 for one (now-superseded) entry.
  for (const point of points) {
    assert.ok(point.centerX >= 0 && point.centerX <= 1);
    assert.ok(point.centerY >= 0 && point.centerY <= 1);
  }
});

test("speechIntervals are encoded onto the command line only when provided", async () => {
  const { trackFaces } = await importFaceTrackWithFakePython("fake-echo-argv.sh");
  const dir = mkdtempSync(path.join(tmpdir(), "facetrack-argv-"));
  const outputPath = path.join(dir, "argv.json");
  process.env.FAKE_ARGV_OUTPUT_PATH = outputPath;
  try {
    await trackFaces("/some/video.mp4", 0, 1);
    const withoutIntervals = JSON.parse(readFileSync(outputPath, "utf8")) as string[];
    assert.equal(withoutIntervals.length, 4); // video, start, end, sampleFps -- no 5th arg at all

    await trackFaces("/some/video.mp4", 0, 1, {
      speechIntervals: [
        { start: 1, end: 2.5 },
        { start: 4, end: 6.25 },
      ],
    });
    const withIntervals = JSON.parse(readFileSync(outputPath, "utf8")) as string[];
    assert.equal(withIntervals.length, 5);
    assert.equal(withIntervals[4], "1.00-2.50,4.00-6.25");
  } finally {
    delete process.env.FAKE_ARGV_OUTPUT_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});
