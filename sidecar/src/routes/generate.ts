import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { nanoid } from "nanoid";
import { getProject, registerMediaFile, saveProject, storageDir } from "../db.js";
import { probeMedia } from "../ffprobe.js";
import { generateImage, generateVideo, generateVoiceover, VideoGenerationUnavailableError, type ImageSize, type TtsVoice } from "../generate.js";
import { stableHash } from "../../../shared/hash.js";
import type { AssetProvenance, MediaAsset, Project, TimelineItem } from "../../../shared/timeline.js";
import { clipDuration } from "../../../shared/timeline-math.js";

const mediaDir = path.join(storageDir, "media");
const GENERATION_PROVIDER = "openai";

export const projectGenerateRouter = Router();

/** Finds a previously generated asset with the exact same provider/model/
 * promptHash -- an unchanged generation request is free (no API call, no
 * duplicate file on disk), matching the "unchanged spec = free re-mount"
 * caching idea generative-asset-as-lazy-ref systems use. A caller invoking
 * generate again with the same input still gets a new TimelineItem placed
 * (they asked to place another instance), just against the reused asset. */
function findCachedAsset(project: Project, model: string, promptHash: string): MediaAsset | null {
  return (
    project.media.find(
      (asset) =>
        asset.provenance?.sourceType === "generated" &&
        asset.provenance.provider === GENERATION_PROVIDER &&
        asset.provenance.model === model &&
        asset.provenance.promptHash === promptHash,
    ) ?? null
  );
}

function appendToTrack(
  project: Project,
  trackKind: "audio" | "elements",
  buildItem: (trackId: string, startSec: number) => TimelineItem | null,
): TimelineItem | null {
  const track = project.tracks.find((t) => t.kind === trackKind);
  if (!track) return null;
  const trackEnd = project.clips
    .filter((item) => item.trackId === track.id)
    .reduce((max, item) => Math.max(max, item.startSec + clipDuration(item)), 0);
  return buildItem(track.id, trackEnd);
}

projectGenerateRouter.post("/:id/generate/voice", async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const body = req.body as { text?: string; voice?: TtsVoice };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Missing text field" });
    return;
  }
  const voice = body.voice ?? "alloy";
  const model = "gpt-4o-mini-tts";
  const promptHash = stableHash({ type: "voice", text, voice, model });

  try {
    let media = findCachedAsset(project, model, promptHash);

    if (!media) {
      const result = await generateVoiceover({ text, voice });
      const mediaId = nanoid();
      const filePath = path.join(mediaDir, `${mediaId}${result.extension}`);
      await writeFile(filePath, result.buffer);
      const probed = await probeMedia(filePath);
      const provenance: AssetProvenance = {
        sourceType: "generated",
        provider: GENERATION_PROVIDER,
        model,
        promptHash,
        generationJobId: nanoid(),
      };
      media = {
        id: mediaId,
        fileName: `voiceover-${mediaId}.mp3`,
        mimeType: result.mimeType,
        durationSec: probed.durationSec,
        width: 0,
        height: 0,
        fps: 0,
        hasAudio: true,
        createdAt: new Date().toISOString(),
        provenance,
      };
      registerMediaFile(mediaId, project.id, filePath, result.mimeType);
    }

    const newItem = appendToTrack(project, "audio", (trackId, startSec) => ({
      id: nanoid(),
      trackId,
      kind: "audio",
      assetId: media!.id,
      startSec,
      durationSec: media!.durationSec,
      trimInSec: 0,
      trimOutSec: media!.durationSec,
      volume: 1,
    }));

    const alreadyStored = project.media.some((asset) => asset.id === media!.id);
    const updated: Project = {
      ...project,
      media: alreadyStored ? project.media : [...project.media, media],
      clips: newItem ? [...project.clips, newItem] : project.clips,
      updatedAt: new Date().toISOString(),
    };
    saveProject(updated);
    res.status(201).json(updated);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Voiceover generation failed" });
  }
});

projectGenerateRouter.post("/:id/generate/image", async (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const body = req.body as { prompt?: string; size?: ImageSize };
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "Missing prompt field" });
    return;
  }
  const size = body.size ?? "1024x1536";
  const model = "gpt-image-1";
  const promptHash = stableHash({ type: "image", prompt, size, model });

  try {
    let media = findCachedAsset(project, model, promptHash);

    if (!media) {
      const result = await generateImage({ prompt, size });
      const mediaId = nanoid();
      const filePath = path.join(mediaDir, `${mediaId}${result.extension}`);
      await writeFile(filePath, result.buffer);
      const probed = await probeMedia(filePath);
      const provenance: AssetProvenance = {
        sourceType: "generated",
        provider: GENERATION_PROVIDER,
        model,
        promptHash,
        generationJobId: nanoid(),
      };
      media = {
        id: mediaId,
        fileName: `generated-${mediaId}.png`,
        mimeType: result.mimeType,
        durationSec: 5,
        width: probed.width,
        height: probed.height,
        fps: 0,
        hasAudio: false,
        createdAt: new Date().toISOString(),
        provenance,
      };
      registerMediaFile(mediaId, project.id, filePath, result.mimeType);
    }

    const newItem = appendToTrack(project, "elements", (trackId, startSec) => ({
      id: nanoid(),
      trackId,
      kind: "image",
      assetId: media!.id,
      startSec,
      durationSec: media!.durationSec,
      fit: "cover",
    }));

    const alreadyStored = project.media.some((asset) => asset.id === media!.id);
    const updated: Project = {
      ...project,
      media: alreadyStored ? project.media : [...project.media, media],
      clips: newItem ? [...project.clips, newItem] : project.clips,
      updatedAt: new Date().toISOString(),
    };
    saveProject(updated);
    res.status(201).json(updated);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Image generation failed" });
  }
});

// Not a real capability yet -- see generate.ts's VideoGenerationUnavailableError.
// Routed explicitly (rather than left absent) so the client gets a clear 501
// with an explanation instead of a generic 404.
projectGenerateRouter.post("/:id/generate/video", async (_req, res) => {
  try {
    await generateVideo();
  } catch (error) {
    if (error instanceof VideoGenerationUnavailableError) {
      res.status(501).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Video generation failed" });
  }
});
