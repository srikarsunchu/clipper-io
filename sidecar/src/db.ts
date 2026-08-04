import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Project } from "../../shared/timeline.js";
import { normalizeProject } from "../../shared/timeline-math.js";

export const storageDir = path.join(import.meta.dirname, "..", "storage");
mkdirSync(storageDir, { recursive: true });

export const db = new Database(path.join(storageDir, "clipwire.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS renders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export function saveProject(project: Project): void {
  db.prepare(
    `INSERT INTO projects (id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(project.id, JSON.stringify(project), project.updatedAt);
}

export function getProject(id: string): Project | null {
  const row = db.prepare(`SELECT data FROM projects WHERE id = ?`).get(id) as { data: string } | undefined;
  // Normalizing at the single DB read choke point means every route always sees
  // a fully-migrated project (e.g. legacy faceTrack -> faceTracksByMediaId)
  // without every call site needing to remember to do it itself.
  return row ? normalizeProject(JSON.parse(row.data) as Project) : null;
}

export function listProjects(): Project[] {
  const rows = db.prepare(`SELECT data FROM projects ORDER BY updated_at DESC`).all() as { data: string }[];
  return rows.map((row) => normalizeProject(JSON.parse(row.data) as Project));
}

export function registerMediaFile(id: string, projectId: string, filePath: string, mimeType: string): void {
  db.prepare(
    `INSERT INTO media_files (id, project_id, file_path, mime_type) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET file_path = excluded.file_path, mime_type = excluded.mime_type`
  ).run(id, projectId, filePath, mimeType);
}

export function getMediaFile(id: string): { filePath: string; mimeType: string } | null {
  const row = db.prepare(`SELECT file_path, mime_type FROM media_files WHERE id = ?`).get(id) as
    | { file_path: string; mime_type: string }
    | undefined;
  return row ? { filePath: row.file_path, mimeType: row.mime_type } : null;
}

/** Same lookup as `getMediaFile`, but enforces that the file actually belongs
 * to the given project at the query level -- used anywhere a request supplies
 * both a projectId and a mediaId, so one project can never reach into
 * another's media file (e.g. a guessed/leaked mediaId) by construction rather
 * than by an easy-to-miss application-level check. */
export function getMediaFileForProject(
  projectId: string,
  mediaId: string
): { filePath: string; mimeType: string } | null {
  const row = db
    .prepare(`SELECT file_path, mime_type FROM media_files WHERE id = ? AND project_id = ?`)
    .get(mediaId, projectId) as { file_path: string; mime_type: string } | undefined;
  return row ? { filePath: row.file_path, mimeType: row.mime_type } : null;
}

export function registerRender(id: string, projectId: string, filePath: string): void {
  db.prepare(`INSERT INTO renders (id, project_id, file_path, created_at) VALUES (?, ?, ?, ?)`).run(
    id,
    projectId,
    filePath,
    new Date().toISOString()
  );
}

export function getRenderFile(id: string): { filePath: string } | null {
  const row = db.prepare(`SELECT file_path FROM renders WHERE id = ?`).get(id) as { file_path: string } | undefined;
  return row ? { filePath: row.file_path } : null;
}
