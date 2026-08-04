import { Router } from "express";
import { nanoid } from "nanoid";
import { getMediaFileForProject, getProject, listProjects, saveProject, storageDir } from "../db.js";
import { trackFaces } from "../faceTrack.js";
import { findMoments } from "../findMoments.js";
import { transcribeMedia } from "../transcribe.js";
import {
  AI_CLIP_TYPES,
  type AiClipType,
  type AiGeneration,
  type FindMomentsRequest,
} from "../../../shared/ai-edit.js";
import type { FaceTrackPoint, FaceTrackRange, MediaFaceTrack, Project, Track, TrackKind } from "../../../shared/timeline.js";
import { normalizeFaceTrackPoints, normalizeRanges, readMediaFaceTrack } from "../../../shared/timeline-math.js";

const MAX_TRACK_SECONDS_PER_REQUEST = 20 * 60; // generous for a personal tool, still a real ceiling on a runaway request

// The sidecar's own storage path can leak into subprocess/ffmpeg error text;
// strip it out of anything that reaches an HTTP response.
function sanitizeErrorMessage(message: string): string {
  const escaped = storageDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return message.replace(new RegExp(escaped, "g"), "<storage>");
}

const DEFAULT_TRACKS: { kind: TrackKind; name: string }[] = [
  { kind: "video", name: "Video" },
  { kind: "caption", name: "Captions" },
  { kind: "broll", name: "B-roll" },
  { kind: "audio", name: "Audio" },
];

function createDefaultTracks(): Track[] {
  return DEFAULT_TRACKS.map((track, order) => ({ id: nanoid(), kind: track.kind, name: track.name, order }));
}

export const projectsRouter = Router();

projectsRouter.get("/", (_req, res) => {
  const projects = listProjects().map((project) => ({
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    durationSec: project.media.reduce((max, media) => Math.max(max, media.durationSec), 0),
  }));
  res.json(projects);
});

projectsRouter.post("/", (req, res) => {
  const now = new Date().toISOString();
  const project: Project = {
      schemaVersion: 1,
    id: nanoid(),
    name: typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : "Untitled project",
    createdAt: now,
    updatedAt: now,
    media: [],
    tracks: createDefaultTracks(),
    clips: [],
    transcript: null,
    transcriptMediaId: null,
    faceTrack: null,
    faceTrackMediaId: null,
  };
  saveProject(project);
  res.status(201).json(project);
});

projectsRouter.get("/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

projectsRouter.put("/:id", (req, res) => {
  const existing = getProject(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const body = req.body as Partial<Pick<Project, "name" | "tracks" | "clips" | "sourceTimelineSnapshot">>;
  const updated: Project = {
    ...existing,
    name: body.name ?? existing.name,
    tracks: body.tracks ?? existing.tracks,
    clips: body.clips ?? existing.clips,
    sourceTimelineSnapshot:
      body.sourceTimelineSnapshot === undefined
        ? existing.sourceTimelineSnapshot
        : body.sourceTimelineSnapshot,
    updatedAt: new Date().toISOString(),
  };
  saveProject(updated);
  res.json(updated);
});

projectsRouter.post("/:id/transcribe", async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const mediaId = String(req.body?.mediaId ?? "");
  const media = project.media.find((item) => item.id === mediaId);
  if (!media) {
    res.status(400).json({ error: "Unknown mediaId" });
    return;
  }

  const file = getMediaFileForProject(project.id, mediaId);
  if (!file) {
    res.status(404).json({ error: "Media file not found on disk" });
    return;
  }

  try {
    const words = await transcribeMedia(file.filePath);
    const updated: Project = {
      ...project,
      transcript: words,
      transcriptMediaId: mediaId,
      updatedAt: new Date().toISOString(),
    };
    saveProject(updated);
    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed";
    res.status(500).json({ error: sanitizeErrorMessage(message) });
  }
});

projectsRouter.post("/:id/find-moments", async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!project.transcript || !project.transcript.length) {
    res.status(400).json({ error: "Transcribe this project's media before finding moments" });
    return;
  }

  const sourceMediaId = String(req.body?.sourceMediaId ?? "");
  if (!sourceMediaId || project.transcriptMediaId !== sourceMediaId) {
    res.status(409).json({ error: "The active source must be transcribed before generating clips" });
    return;
  }

  const clipTypes = Array.isArray(req.body?.clipTypes)
    ? req.body.clipTypes.filter((value: unknown): value is AiClipType =>
        typeof value === "string" && AI_CLIP_TYPES.includes(value as AiClipType))
    : [];
  const count = Math.max(1, Math.min(12, Math.round(Number(req.body?.count ?? 5))));
  const minDurationSec = Math.max(5, Math.min(180, Number(req.body?.minDurationSec ?? 15)));
  const maxDurationSec = Math.max(minDurationSec, Math.min(180, Number(req.body?.maxDurationSec ?? 60)));
  if (!clipTypes.length || !Number.isFinite(count) || !Number.isFinite(minDurationSec) || !Number.isFinite(maxDurationSec)) {
    res.status(400).json({ error: "Invalid AI clip generation settings" });
    return;
  }
  const request: FindMomentsRequest = {
    sourceMediaId,
    clipTypes,
    count,
    minDurationSec,
    maxDurationSec,
    prompt: typeof req.body?.prompt === "string" ? req.body.prompt.slice(0, 500) : undefined,
  };

  try {
    const moments = await findMoments(project.transcript, request);
    const generation: AiGeneration = {
      id: nanoid(),
      sourceMediaId,
      request,
      moments,
      createdAt: new Date().toISOString(),
    };
    const updated: Project = {
      ...project,
      aiGenerations: [...(project.aiGenerations ?? []).slice(-9), generation],
      updatedAt: generation.createdAt,
    };
    saveProject(updated);
    res.json({ generation, transcriptMediaId: sourceMediaId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Finding moments failed";
    res.status(500).json({ error: sanitizeErrorMessage(message) });
  }
});

projectsRouter.post("/:id/track-faces", async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const mediaId = typeof req.body?.mediaId === "string" ? req.body.mediaId.trim() : "";
  if (!mediaId) {
    res.status(400).json({ error: "mediaId is required" });
    return;
  }

  // Membership in this project's own media list is the real ownership check --
  // mediaId is only ever added to it by this project's own upload route.
  const media = project.media.find((item) => item.id === mediaId);
  if (!media) {
    res.status(400).json({ error: "mediaId does not belong to this project" });
    return;
  }
  if (!media.mimeType.startsWith("video/")) {
    res.status(400).json({ error: "Face tracking requires a video mediaId" });
    return;
  }

  // Belt-and-suspenders: enforce ownership in the query itself, not just via
  // the in-memory project.media check above.
  const file = getMediaFileForProject(project.id, mediaId);
  if (!file) {
    res.status(404).json({ error: "Media file is not available" });
    return;
  }

  if (!Array.isArray(req.body?.segments)) {
    res.status(400).json({ error: "segments must be an array" });
    return;
  }
  const rawSegments = req.body.segments as unknown[];
  if (!rawSegments.length) {
    res.status(400).json({ error: "At least one segment is required" });
    return;
  }

  const requestedSegments: FaceTrackRange[] = [];
  for (const raw of rawSegments) {
    const candidate = (raw ?? {}) as { startSec?: unknown; endSec?: unknown };
    const startSec = Number(candidate.startSec);
    const endSec = Number(candidate.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
      res.status(400).json({ error: "Each segment's startSec/endSec must be finite numbers" });
      return;
    }
    if (startSec < 0 || endSec <= startSec) {
      res.status(400).json({ error: "Each segment's startSec must be >= 0 and endSec must be greater than startSec" });
      return;
    }
    requestedSegments.push({
      startSec,
      endSec: media.durationSec > 0 ? Math.min(endSec, media.durationSec) : endSec,
    });
  }

  const mergedSegments = normalizeRanges(requestedSegments);
  const totalRequestedSec = mergedSegments.reduce((sum, segment) => sum + (segment.endSec - segment.startSec), 0);
  if (totalRequestedSec > MAX_TRACK_SECONDS_PER_REQUEST) {
    res.status(400).json({
      error: `Requested tracking duration (${Math.round(totalRequestedSec)}s) exceeds the ${MAX_TRACK_SECONDS_PER_REQUEST}s limit per request`,
    });
    return;
  }

  try {
    const existing = readMediaFaceTrack(project, mediaId);
    const newPoints: FaceTrackPoint[] = [];
    for (const segment of mergedSegments) {
      const points = await trackFaces(file.filePath, segment.startSec, segment.endSec);
      newPoints.push(...points);
    }

    const mergedTrack: MediaFaceTrack = {
      points: normalizeFaceTrackPoints([...existing.points, ...newPoints]),
      segments: normalizeRanges([...existing.segments, ...mergedSegments]),
      updatedAt: new Date().toISOString(),
    };

    const updated: Project = {
      ...project,
      faceTracksByMediaId: { ...(project.faceTracksByMediaId ?? {}), [mediaId]: mergedTrack },
      updatedAt: mergedTrack.updatedAt,
    };
    saveProject(updated);
    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Face tracking failed";
    res.status(500).json({ error: sanitizeErrorMessage(message) });
  }
});
