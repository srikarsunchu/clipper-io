import type { Project, ProjectSummary } from "../shared/timeline";
import type { CaptionStyleId } from "../shared/render-contract";
import type {
  FindMomentsRequest,
  FindMomentsResponse,
} from "../shared/ai-edit";

export type { FindMomentsPreferences, MomentCandidate } from "../shared/ai-edit";

const SIDECAR_URL = process.env.NEXT_PUBLIC_SIDECAR_URL ?? "http://localhost:4310";

async function asJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Sidecar request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function listProjects(): Promise<ProjectSummary[]> {
  return fetch(`${SIDECAR_URL}/projects`).then((response) => asJson<ProjectSummary[]>(response));
}

export function createProject(name: string): Promise<Project> {
  return fetch(`${SIDECAR_URL}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((response) => asJson<Project>(response));
}

export function fetchProject(id: string): Promise<Project> {
  return fetch(`${SIDECAR_URL}/projects/${id}`).then((response) => asJson<Project>(response));
}

export function saveProjectTimeline(
  id: string,
  patch: Partial<Pick<Project, "name" | "tracks" | "clips" | "sourceTimelineSnapshot">>
): Promise<Project> {
  return fetch(`${SIDECAR_URL}/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((response) => asJson<Project>(response));
}

export function uploadMedia(projectId: string, file: File): Promise<Project> {
  const formData = new FormData();
  formData.append("file", file);
  return fetch(`${SIDECAR_URL}/projects/${projectId}/media`, {
    method: "POST",
    body: formData,
  }).then((response) => asJson<Project>(response));
}

export function mediaFileUrl(mediaId: string): string {
  return `${SIDECAR_URL}/media/${mediaId}/file`;
}

export function transcribeMedia(projectId: string, mediaId: string): Promise<Project> {
  return fetch(`${SIDECAR_URL}/projects/${projectId}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId }),
  }).then((response) => asJson<Project>(response));
}

// The server derives the full render plan from the stored project via
// buildRenderPlan -- the client only needs to say how, not hand-assemble
// segments/cues/face-track data itself (that duplication is exactly what let
// preview and export drift apart before).
export interface RenderRequest {
  style: CaptionStyleId;
  width: number;
  height: number;
  fps: number;
}

export function renderProject(projectId: string, request: RenderRequest): Promise<{ renderId: string; downloadUrl: string }> {
  return fetch(`${SIDECAR_URL}/projects/${projectId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }).then((response) => asJson<{ renderId: string; downloadUrl: string }>(response));
}

export function renderDownloadUrl(downloadUrl: string): string {
  return `${SIDECAR_URL}${downloadUrl}`;
}

export function findMoments(
  projectId: string,
  request: FindMomentsRequest,
): Promise<FindMomentsResponse> {
  return fetch(`${SIDECAR_URL}/projects/${projectId}/find-moments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }).then((response) => asJson<FindMomentsResponse>(response));
}

export function trackFaces(
  projectId: string,
  mediaId: string,
  segments: { startSec: number; endSec: number }[]
): Promise<Project> {
  return fetch(`${SIDECAR_URL}/projects/${projectId}/track-faces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaId, segments }),
  }).then((response) => asJson<Project>(response));
}

export type TtsVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" | "ash" | "coral" | "sage";

// Generation is best-effort and can be slow (a few seconds per call) --
// callers should show their own pending state rather than assume this
// resolves quickly. Placed onto the project's Audio/Elements track by the
// sidecar itself so the caller doesn't have to hand-assemble a TimelineItem.
export function generateVoiceover(projectId: string, text: string, voice?: TtsVoice): Promise<Project> {
  return fetch(`${SIDECAR_URL}/projects/${projectId}/generate/voice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  }).then((response) => asJson<Project>(response));
}

export function generateImage(projectId: string, prompt: string): Promise<Project> {
  return fetch(`${SIDECAR_URL}/projects/${projectId}/generate/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  }).then((response) => asJson<Project>(response));
}
