import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { FaceTrackPoint } from "../../shared/timeline.js";
import { normalizeFaceTrackPoints } from "../../shared/timeline-math.js";

const execFileAsync = promisify(execFile);

const FACETRACK_DIR = path.join(import.meta.dirname, "..", "facetrack");
const DEFAULT_PYTHON_BIN = path.join(
  FACETRACK_DIR,
  "venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python"
);
// Overridable so a machine that can't use the checked-in venv layout (or a CI
// box with its own interpreter) can still run tracking without editing code.
const PYTHON_BIN = process.env.FACETRACK_PYTHON_BIN?.trim() || DEFAULT_PYTHON_BIN;
const SCRIPT_PATH = path.join(FACETRACK_DIR, "track_faces.py");
const SAMPLE_FPS = "6";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // generous for a personal tool, still a real ceiling on a hung/runaway process
const MAX_BUFFER_BYTES = 1024 * 1024 * 20;

function assertExecutableExists(label: string, filePath: string): void {
  try {
    accessSync(filePath, constants.R_OK);
  } catch {
    throw new Error(
      `Face tracking is not set up: ${label} was not found. Run sidecar/facetrack/setup.sh, then try again.`
    );
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStructurallyValidPoint(value: unknown): value is FaceTrackPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.timeSec) && isFiniteNumber(point.centerX) && isFiniteNumber(point.centerY) && point.timeSec >= 0;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validateAndNormalizePoints(raw: unknown): FaceTrackPoint[] {
  if (!Array.isArray(raw)) {
    throw new Error("Face tracking script returned malformed output: expected an array of points");
  }
  const valid = raw.filter(isStructurallyValidPoint).map((point) => ({
    timeSec: point.timeSec,
    // Coordinates from the tracker should already be in [0,1]; a tiny bit of
    // float slop is fine to clamp, but a structurally invalid point (NaN,
    // wrong shape) is dropped rather than trusted.
    centerX: clampUnit(point.centerX),
    centerY: clampUnit(point.centerY),
  }));
  if (valid.length !== raw.length) {
    console.warn(`faceTrack: dropped ${raw.length - valid.length} malformed point(s) from tracker output`);
  }
  return normalizeFaceTrackPoints(valid);
}

export interface TrackFacesOptions {
  timeoutMs?: number;
}

export async function trackFaces(
  filePath: string,
  startSec: number,
  endSec: number,
  options: TrackFacesOptions = {}
): Promise<FaceTrackPoint[]> {
  assertExecutableExists("the face-tracking Python interpreter", PYTHON_BIN);
  assertExecutableExists("the face-tracking script", SCRIPT_PATH);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(PYTHON_BIN, [SCRIPT_PATH, filePath, String(startSec), String(endSec), SAMPLE_FPS], {
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    }));
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string };
    if (err.killed || err.signal === "SIGKILL" || err.signal === "SIGTERM") {
      throw new Error(`Face tracking timed out after ${timeoutMs}ms`);
    }
    if (err.code === "ENOENT") {
      throw new Error("Face tracking is not set up: the Python interpreter or script could not be executed.");
    }
    // Surface the tracker's own stderr (real diagnostic value) but never the
    // raw error object, which can embed absolute filesystem paths.
    const diagnostic = typeof err.stderr === "string" ? err.stderr.trim().split("\n").slice(-5).join("\n") : "";
    throw new Error(diagnostic ? `Face tracking failed: ${diagnostic}` : "Face tracking failed");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Face tracking script returned invalid JSON");
  }
  const data = parsed as { points?: unknown; error?: unknown };
  if (typeof data.error === "string" && data.error) {
    throw new Error(data.error);
  }
  return validateAndNormalizePoints(data.points ?? []);
}
