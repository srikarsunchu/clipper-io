import { mkdirSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { nanoid } from "nanoid";
import { getRenderFile, getProject, registerRender, storageDir } from "../db.js";
import { renderCaptionedVideo } from "../render.js";
import { buildRenderPlan } from "../../../shared/render-plan.js";
import type { CaptionStyleId } from "../../../shared/render-contract.js";

const rendersDir = path.join(storageDir, "renders");
mkdirSync(rendersDir, { recursive: true });

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
  };

  const port = Number(process.env.PORT ?? 4310);
  // Remotion's asset downloader only accepts http(s) URLs, not file://, so
  // resolve every asset id to the sidecar's own media-streaming route. This
  // resolver is the one piece of this that's environment-specific -- a future
  // remote renderer supplies a different one, buildRenderPlan itself doesn't
  // need to change.
  const resolveAssetUrl = (assetId: string) => `http://localhost:${port}/media/${assetId}/file`;

  try {
    // The plan is derived straight from the project already sitting in the
    // database -- the client no longer hand-assembles segments/cues/face
    // points itself, so there is exactly one place a given project's render
    // output can come from, and preview (once wired to the same plan) can never
    // disagree with export about what a project actually contains.
    const plan = buildRenderPlan(project, resolveAssetUrl, {
      captionStyle: body.style,
      width: body.width,
      height: body.height,
      fps: body.fps,
    });

    if (!plan.layers.length) {
      res.status(400).json({ error: "Project has no timeline items to render" });
      return;
    }

    const renderId = nanoid();
    const outputPath = path.join(rendersDir, `${renderId}.mp4`);
    await renderCaptionedVideo({ plan, outputPath });
    registerRender(renderId, project.id, outputPath);
    res.status(201).json({ renderId, downloadUrl: `/renders/${renderId}/file` });
  } catch (error) {
    console.error(error);
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
