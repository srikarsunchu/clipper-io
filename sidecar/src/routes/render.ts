import { mkdirSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { nanoid } from "nanoid";
import { getMediaFileForProject, getProject, getRenderFile, registerRender, storageDir } from "../db.js";
import { renderCaptionedVideo } from "../render.js";
import type { CaptionStyleId, RenderCue, RenderFacePoint, RenderFaceRange, RenderSegment } from "../../../shared/render-contract.js";

const rendersDir = path.join(storageDir, "renders");
mkdirSync(rendersDir, { recursive: true });

interface RenderRequestSegment {
  mediaId: string;
  trimStartSec: number;
  trimEndSec: number;
  sequenceStartSec: number;
  facePoints?: RenderFacePoint[];
  faceCoverage?: RenderFaceRange[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeFacePoints(value: unknown): RenderFacePoint[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (point): point is RenderFacePoint =>
      !!point &&
      typeof point === "object" &&
      isFiniteNumber((point as RenderFacePoint).editTimeSec) &&
      isFiniteNumber((point as RenderFacePoint).centerX) &&
      isFiniteNumber((point as RenderFacePoint).centerY)
  );
}

function sanitizeFaceCoverage(value: unknown): RenderFaceRange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (range): range is RenderFaceRange =>
      !!range &&
      typeof range === "object" &&
      isFiniteNumber((range as RenderFaceRange).startSec) &&
      isFiniteNumber((range as RenderFaceRange).endSec) &&
      (range as RenderFaceRange).endSec > (range as RenderFaceRange).startSec
  );
}

export const projectRenderRouter = Router();

projectRenderRouter.post("/:id/render", async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const body = req.body as {
    style?: CaptionStyleId;
    width?: number;
    height?: number;
    fps?: number;
    durationSec?: number;
    segments?: RenderRequestSegment[];
    cues?: RenderCue[];
  };

  const requestSegments = body.segments ?? [];
  if (!requestSegments.length) {
    res.status(400).json({ error: "At least one segment is required" });
    return;
  }

  const port = Number(process.env.PORT ?? 4310);
  const segments: RenderSegment[] = [];
  for (const segment of requestSegments) {
    // Membership in this project's own media list is the ownership check -- a
    // render request can never pull in another project's media by mediaId.
    const media = project.media.find((item) => item.id === segment.mediaId);
    if (!media) {
      res.status(400).json({ error: `mediaId ${segment.mediaId} does not belong to this project` });
      return;
    }
    const file = getMediaFileForProject(project.id, segment.mediaId);
    if (!file) {
      res.status(400).json({ error: `Media file not found for mediaId ${segment.mediaId}` });
      return;
    }
    segments.push({
      // Remotion's asset downloader only accepts http(s) URLs, not file://, so we
      // point it at the sidecar's own media-streaming route rather than a raw path.
      src: `http://localhost:${port}/media/${segment.mediaId}/file`,
      trimStartSec: segment.trimStartSec,
      trimEndSec: segment.trimEndSec,
      sequenceStartSec: segment.sequenceStartSec,
      sourceWidth: media.width,
      sourceHeight: media.height,
      // Scoped to this segment's own media only -- never a route-wide shared
      // list, so one media's tracked position can never render under another
      // media's segment.
      facePoints: sanitizeFacePoints(segment.facePoints),
      faceCoverage: sanitizeFaceCoverage(segment.faceCoverage),
    });
  }

  const renderId = nanoid();
  const outputPath = path.join(rendersDir, `${renderId}.mp4`);

  try {
    await renderCaptionedVideo({
      segments,
      cues: body.cues ?? [],
      style: body.style ?? "pop",
      durationSec: body.durationSec ?? 1,
      width: body.width ?? 1080,
      height: body.height ?? 1920,
      fps: body.fps ?? 30,
      outputPath,
    });
    registerRender(renderId, project.id, outputPath);
    res.status(201).json({ renderId, downloadUrl: `/renders/${renderId}/file` });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Render failed" });
  }
});

export const renderFileRouter = Router();

renderFileRouter.get("/:id/file", (req, res) => {
  const render = getRenderFile(String(req.params.id));
  if (!render) {
    res.status(404).json({ error: "Render not found" });
    return;
  }
  res.download(render.filePath, "clipwire-export.mp4");
});
