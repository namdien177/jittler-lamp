import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { strFromU8, unzipSync, zipSync } from "fflate";

import { sessionArchiveSchema } from "@jittle-lamp/shared";

import type { ViewerPayload } from "../rpc";

const activeTempSessions = new Map<string, { videoPath: string }>();

export async function importZipBundle(zipBytes: Uint8Array): Promise<ViewerPayload> {
  const files = unzipSync(zipBytes);

  let eventsEntry: Uint8Array | undefined;
  let webmEntry: Uint8Array | undefined;

  for (const [path, content] of Object.entries(files)) {
    const name = path.split("/").pop();
    if (name === "session.archive.json") {
      eventsEntry = content;
    }
    if (name === "recording.webm") {
      webmEntry = content;
    }
  }

  if (!eventsEntry) {
    throw new Error("ZIP is missing session.archive.json");
  }
  if (!webmEntry) {
    throw new Error("ZIP is missing recording.webm");
  }

  const raw = JSON.parse(strFromU8(eventsEntry)) as unknown;
  const result = sessionArchiveSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`Invalid session bundle: ${result.error.message}`);
  }

  const bundle = result.data;
  const tempId = crypto.randomUUID();
  const tempDir = resolve(join(tmpdir(), "jittle-lamp-temp"));

  await mkdir(tempDir, { recursive: true });

  const fileName = `${tempId}.webm`;
  if (basename(fileName) !== fileName) {
    throw new Error("Unsafe temp file name generated.");
  }

  const videoPath = join(tempDir, fileName);
  await writeFile(videoPath, webmEntry);

  activeTempSessions.set(tempId, { videoPath });

  return { source: "zip", archive: bundle, videoPath, notes: "", tempId };
}

export async function clearTempSession(tempId: string): Promise<void> {
  const entry = activeTempSessions.get(tempId);
  if (!entry) return;

  activeTempSessions.delete(tempId);
  await rm(entry.videoPath, { force: true });
}

export async function loadLocalSession(folderPath: string): Promise<ViewerPayload> {
  const eventsPath = join(folderPath, "session.archive.json");
  const videoPath = join(folderPath, "recording.webm");

  const [eventsStat, videoStat] = await Promise.all([
    stat(eventsPath).catch(() => null),
    stat(videoPath).catch(() => null)
  ]);

  if (!eventsStat?.isFile()) {
    throw new Error("Folder is missing session.archive.json");
  }
  if (!videoStat?.isFile()) {
    throw new Error("Folder is missing recording.webm");
  }

  const raw = JSON.parse(await readFile(eventsPath, "utf8")) as unknown;
  const result = sessionArchiveSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`Invalid session bundle: ${result.error.message}`);
  }

  return { source: "local", archive: result.data, videoPath, notes: "" };
}

export async function buildSessionZip(sessionFolderPath: string): Promise<Uint8Array> {
  const eventsPath = join(sessionFolderPath, "session.archive.json");
  const videoPath = join(sessionFolderPath, "recording.webm");

  const [eventsBytes, webmBytes] = await Promise.all([readFile(eventsPath), readFile(videoPath)]);

  return zipSync({
    "session.archive.json": new Uint8Array(eventsBytes),
    "recording.webm": new Uint8Array(webmBytes)
  });
}
