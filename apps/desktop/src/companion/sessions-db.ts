import { Database } from "bun:sqlite";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { sessionBundleSchema } from "@jittle-lamp/shared";

import type { ViewerPayload } from "../rpc";

type ArtifactName = "recording.webm" | "session.events.json";

export type SessionArtifact = {
  artifactName: string;
  destinationPath: string;
  bytes: number;
  at: string;
};

export type SessionRecord = {
  sessionId: string;
  sessionFolder: string;
  artifacts: SessionArtifact[];
  totalBytes: number;
  recordedAt: string;
  tags: string[];
  notes: string;
};

type SessionWriteRow = {
  id: string;
  session_id: string;
  artifact_name: string;
  destination_path: string;
  session_folder: string;
  bytes: number;
  at: string;
};

const defaultDbDir = join(homedir(), ".jittle-lamp");
const defaultDbPath = join(defaultDbDir, "sessions.db");

let _overrideDbPath: string | null = null;
let db: Database | null = null;

/**
 * Override the SQLite path used for this process. Only intended for isolated
 * test runs – call once before any DB access and never in production code.
 */
export function _testOverrideDb(path: string): void {
  if (db) {
    db.close();
    db = null;
  }
  _overrideDbPath = path;
}

function resolvedDbPath(): string {
  return _overrideDbPath ?? defaultDbPath;
}

function getDb(): Database {
  if (db) return db;

  db = new Database(resolvedDbPath());
  db.run(`
    CREATE TABLE IF NOT EXISTS session_writes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      artifact_name TEXT NOT NULL,
      destination_path TEXT NOT NULL,
      session_folder TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_session_writes_session_id
    ON session_writes (session_id)
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS session_tags (
      session_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (session_id, tag)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS session_meta (
      session_id TEXT PRIMARY KEY,
      notes TEXT NOT NULL DEFAULT ''
    )
  `);

  return db;
}

export async function initSessionsDb(): Promise<void> {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(resolvedDbPath()), { recursive: true }));
  getDb();
}

export function insertSessionWrite(input: {
  id: string;
  sessionId: string;
  artifactName: ArtifactName;
  destinationPath: string;
  sessionFolder: string;
  bytes: number;
  at: string;
}): void {
  getDb().run(
    `INSERT OR REPLACE INTO session_writes
     (id, session_id, artifact_name, destination_path, session_folder, bytes, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.id, input.sessionId, input.artifactName, input.destinationPath, input.sessionFolder, input.bytes, input.at]
  );
}

/**
 * Scan `outputDir` on the filesystem and return a `SessionRecord` for every
 * subfolder that contains both `recording.webm` and a valid
 * `session.events.json` (validated against `sessionBundleSchema`).
 *
 * SQLite metadata (tags, notes) is joined on top. Sessions whose JSON bundle
 * fails validation are silently skipped.
 */
export async function scanLibrarySessions(outputDir: string): Promise<SessionRecord[]> {
  const glob = new Bun.Glob("*");
  const names: string[] = [];

  try {
    for await (const name of glob.scan({ cwd: outputDir, onlyFiles: false })) {
      names.push(name);
    }
  } catch {
    // Output dir doesn't exist yet — normal on first run.
    return [];
  }

  // Pre-load all tags and notes so we only hit the DB once.
  const tagRows = getDb()
    .query<{ session_id: string; tag: string }, []>(
      `SELECT session_id, tag FROM session_tags ORDER BY tag ASC`
    )
    .all();

  const metaRows = getDb()
    .query<{ session_id: string; notes: string }, []>(
      `SELECT session_id, notes FROM session_meta`
    )
    .all();

  const tagsBySession = new Map<string, string[]>();
  for (const row of tagRows) {
    const existing = tagsBySession.get(row.session_id);
    if (existing) {
      existing.push(row.tag);
    } else {
      tagsBySession.set(row.session_id, [row.tag]);
    }
  }

  const notesBySession = new Map<string, string>();
  for (const row of metaRows) {
    notesBySession.set(row.session_id, row.notes);
  }

  const sessions: SessionRecord[] = [];

  for (const name of names) {
    const folderPath = join(outputDir, name);
    const folderStat = await stat(folderPath).catch(() => null);
    if (!folderStat?.isDirectory()) continue;

    const sessionId = name;
    const webmPath = join(folderPath, "recording.webm");
    const eventsPath = join(folderPath, "session.events.json");

    let webmBytes: number;
    let eventsBytes: number;

    try {
      const [webmStat, eventsStat] = await Promise.all([stat(webmPath), stat(eventsPath)]);
      webmBytes = webmStat.size;
      eventsBytes = eventsStat.size;
    } catch {
      // Missing one or both artifacts — skip this folder.
      continue;
    }

    let bundle: ReturnType<typeof sessionBundleSchema.parse>;

    try {
      const raw = JSON.parse(await readFile(eventsPath, "utf8")) as unknown;
      const result = sessionBundleSchema.safeParse(raw);
      if (!result.success) continue;
      bundle = result.data;
    } catch {
      continue;
    }

    const artifactAt = bundle.createdAt;

    sessions.push({
      sessionId,
      sessionFolder: folderPath,
      artifacts: [
        {
          artifactName: "recording.webm",
          destinationPath: webmPath,
          bytes: webmBytes,
          at: artifactAt
        },
        {
          artifactName: "session.events.json",
          destinationPath: eventsPath,
          bytes: eventsBytes,
          at: artifactAt
        }
      ],
      totalBytes: webmBytes + eventsBytes,
      recordedAt: bundle.createdAt,
      tags: tagsBySession.get(sessionId) ?? [],
      notes: notesBySession.get(sessionId) ?? ""
    });
  }

  return sessions.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

/** @deprecated Use `scanLibrarySessions` for folder-backed discovery instead. */
export function listSessionRecords(): SessionRecord[] {
  const rows = getDb()
    .query<SessionWriteRow, []>(
      `SELECT id, session_id, artifact_name, destination_path, session_folder, bytes, at
       FROM session_writes
       ORDER BY at ASC`
    )
    .all();

  const tagRows = getDb()
    .query<{ session_id: string; tag: string }, []>(
      `SELECT session_id, tag FROM session_tags ORDER BY tag ASC`
    )
    .all();

  const metaRows = getDb()
    .query<{ session_id: string; notes: string }, []>(
      `SELECT session_id, notes FROM session_meta`
    )
    .all();

  const tagsBySession = new Map<string, string[]>();
  for (const row of tagRows) {
    const existing = tagsBySession.get(row.session_id);
    if (existing) {
      existing.push(row.tag);
    } else {
      tagsBySession.set(row.session_id, [row.tag]);
    }
  }

  const notesBySession = new Map<string, string>();
  for (const row of metaRows) {
    notesBySession.set(row.session_id, row.notes);
  }

  const sessionMap = new Map<string, SessionRecord>();

  for (const row of rows) {
    const artifact: SessionArtifact = {
      artifactName: row.artifact_name,
      destinationPath: row.destination_path,
      bytes: row.bytes,
      at: row.at
    };

    const existing = sessionMap.get(row.session_id);

    if (existing) {
      existing.artifacts.push(artifact);
      existing.totalBytes += row.bytes;
      if (row.at > existing.recordedAt) existing.recordedAt = row.at;
    } else {
      sessionMap.set(row.session_id, {
        sessionId: row.session_id,
        sessionFolder: row.session_folder,
        artifacts: [artifact],
        totalBytes: row.bytes,
        recordedAt: row.at,
        tags: tagsBySession.get(row.session_id) ?? [],
        notes: notesBySession.get(row.session_id) ?? ""
      });
    }
  }

  return Array.from(sessionMap.values()).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export function addSessionTag(sessionId: string, tag: string): void {
  getDb().run(
    `INSERT OR IGNORE INTO session_tags (session_id, tag) VALUES (?, ?)`,
    [sessionId, tag]
  );
}

export function removeSessionTag(sessionId: string, tag: string): void {
  getDb().run(
    `DELETE FROM session_tags WHERE session_id = ? AND tag = ?`,
    [sessionId, tag]
  );
}

export function listAllTags(): string[] {
  return getDb()
    .query<{ tag: string }, []>(`SELECT DISTINCT tag FROM session_tags ORDER BY tag ASC`)
    .all()
    .map((row) => row.tag);
}

/** Persist a free-text notes string for a library session in SQLite only. */
export function setSessionNotes(sessionId: string, notes: string): void {
  getDb().run(
    `INSERT INTO session_meta (session_id, notes)
     VALUES (?, ?)
     ON CONFLICT(session_id) DO UPDATE SET notes = excluded.notes`,
    [sessionId, notes]
  );
}

/** Return the stored notes for a session, or an empty string if none exist. */
export function getSessionNotes(sessionId: string): string {
  const row = getDb()
    .query<{ notes: string }, [string]>(
      `SELECT notes FROM session_meta WHERE session_id = ?`
    )
    .get(sessionId);

  return row?.notes ?? "";
}

export function removeSessionRecords(sessionId: string): void {
  getDb().run(`DELETE FROM session_writes WHERE session_id = ?`, [sessionId]);
  getDb().run(`DELETE FROM session_tags WHERE session_id = ?`, [sessionId]);
  getDb().run(`DELETE FROM session_meta WHERE session_id = ?`, [sessionId]);
}

export async function loadLibrarySession(sessionId: string, outputDir: string): Promise<ViewerPayload> {
  const safeOutputDir = resolve(outputDir);
  const sessionFolder = resolve(join(safeOutputDir, sessionId));

  if (!sessionFolder.startsWith(safeOutputDir + "/") && sessionFolder !== safeOutputDir) {
    throw new Error("Invalid sessionId: path traversal detected.");
  }

  const eventsPath = join(sessionFolder, "session.events.json");
  const videoPath = join(sessionFolder, "recording.webm");

  const [eventsStat, videoStat] = await Promise.all([
    stat(eventsPath).catch(() => null),
    stat(videoPath).catch(() => null)
  ]);

  if (!eventsStat?.isFile()) {
    throw new Error(`Session not found or missing session.events.json: ${sessionId}`);
  }
  if (!videoStat?.isFile()) {
    throw new Error(`Session not found or missing recording.webm: ${sessionId}`);
  }

  const raw = JSON.parse(await readFile(eventsPath, "utf8")) as unknown;
  const result = sessionBundleSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`Session bundle validation failed for ${sessionId}: ${result.error.message}`);
  }

  return {
    source: "library",
    bundle: result.data,
    videoPath,
    notes: getSessionNotes(sessionId)
  };
}
