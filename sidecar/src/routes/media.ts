import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { getMediaFile, getProject, registerMediaFile, saveProject, storageDir } from "../db.js";
import { probeMedia } from "../ffprobe.js";
import type { AssetProvenance, MediaAsset, TimelineItem } from "../../../shared/timeline.js";
import { clipDuration } from "../../../shared/timeline-math.js";

const mediaDir = path.join(storageDir, "media");

const upload = multer({
  storage: multer.diskStorage({
    destination: mediaDir,
    filename: (_req, file, callback) => {
      callback(null, `${nanoid()}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
});

export const projectMediaRouter = Router();

projectMediaRouter.post("/:id/media", upload.single("file"), async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Missing file field" });
    return;
  }

  try {
    const probed = await probeMedia(req.file.path);
    const mediaId = nanoid();
    const isImage = req.file.mimetype.startsWith("image/");
    const isAudio = req.file.mimetype.startsWith("audio/");
    const durationSec = isImage ? 5 : probed.durationSec;
    const provenance: AssetProvenance = { sourceType: "upload" };
    const media: MediaAsset = {
      id: mediaId,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      durationSec,
      width: probed.width,
      height: probed.height,
      fps: probed.fps,
      hasAudio: probed.hasAudio,
      createdAt: new Date().toISOString(),
      provenance,
    };
    registerMediaFile(mediaId, project.id, req.file.path, req.file.mimetype);

    const targetTrack = project.tracks.find((track) => track.kind === (isAudio ? "audio" : "video"));
    const trackEnd = targetTrack
      ? project.clips
          .filter((item) => item.trackId === targetTrack.id)
          .reduce((max, item) => Math.max(max, item.startSec + clipDuration(item)), 0)
      : 0;

    const newItem: TimelineItem | null = !targetTrack
      ? null
      : isImage
        ? { id: nanoid(), trackId: targetTrack.id, kind: "image", assetId: mediaId, startSec: trackEnd, durationSec, fit: "cover" }
        : isAudio
          ? { id: nanoid(), trackId: targetTrack.id, kind: "audio", assetId: mediaId, startSec: trackEnd, durationSec, trimInSec: 0, trimOutSec: durationSec, volume: 1 }
          : { id: nanoid(), trackId: targetTrack.id, kind: "video", assetId: mediaId, startSec: trackEnd, durationSec, trimInSec: 0, trimOutSec: durationSec, fit: "cover" };

    const updated = {
      ...project,
      media: [...project.media, media],
      clips: newItem ? [...project.clips, newItem] : project.clips,
      updatedAt: new Date().toISOString(),
    };
    saveProject(updated);
    res.status(201).json(updated);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to probe media" });
  }
});

export const mediaFileRouter = Router();

mediaFileRouter.get("/:mediaId/file", async (req, res) => {
  const entry = getMediaFile(req.params.mediaId);
  if (!entry) {
    res.status(404).json({ error: "Media not found" });
    return;
  }

  const stats = await stat(entry.filePath);
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      "Content-Type": entry.mimeType,
      "Content-Length": stats.size,
      "Accept-Ranges": "bytes",
    });
    createReadStream(entry.filePath).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match?.[1] ? Number(match[1]) : 0;
  const end = match?.[2] ? Number(match[2]) : stats.size - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stats.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": entry.mimeType,
  });
  createReadStream(entry.filePath, { start, end }).pipe(res);
});
