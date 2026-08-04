import cors from "cors";
import express from "express";
import { mediaFileRouter, projectMediaRouter } from "./routes/media.js";
import { projectsRouter } from "./routes/projects.js";
import { projectRenderRouter, renderFileRouter } from "./routes/render.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file present; rely on externally-set environment variables
}

const app = express();
const port = Number(process.env.PORT ?? 4310);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/projects", projectsRouter);
app.use("/projects", projectMediaRouter);
app.use("/projects", projectRenderRouter);
app.use("/media", mediaFileRouter);
app.use("/renders", renderFileRouter);

app.listen(port, () => {
  console.log(`clipwire sidecar listening on http://localhost:${port}`);
});
