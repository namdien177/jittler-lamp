import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { unzipSync, zipSync } from "fflate";

import {
  recordingFileName,
  safeParseSessionArchiveJson,
  sessionArchiveFileName,
  type SessionLoader
} from "@jittle-lamp/shared";

import type { ViewerPayload } from "../rpc";

const activeTempSessions = new Map<string, { videoPath: string }>();

class DesktopZipSessionLoader implements SessionLoader<Uint8Array, ViewerPayload> {
  async load(zipBytes: Uint8Array): Promise<ViewerPayload> {
    const files = unzipSync(zipBytes);
    let eventsEntry: Uint8Array | undefined;
    let webmEntry: Uint8Array | undefined;

    for (const [path, content] of Object.entries(files)) {
      const name = path.split("/").pop();
      if (name === sessionArchiveFileName) {
        eventsEntry = content;
      }
      if (name === recordingFileName) {
        webmEntry = content;
      }
    }

    if (!eventsEntry) {
      throw new Error(`ZIP is missing ${sessionArchiveFileName}`);
    }
    if (!webmEntry) {
      throw new Error(`ZIP is missing ${recordingFileName}`);
    }

    const result = safeParseSessionArchiveJson(eventsEntry);

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
}

class DesktopFilePathSessionLoader implements SessionLoader<string, ViewerPayload> {
  async load(folderPath: string): Promise<ViewerPayload> {
    const eventsPath = join(folderPath, sessionArchiveFileName);
    const videoPath = join(folderPath, recordingFileName);

    const [eventsStat, videoStat] = await Promise.all([
      stat(eventsPath).catch(() => null),
      stat(videoPath).catch(() => null)
    ]);

    if (!eventsStat?.isFile()) {
      throw new Error(`Folder is missing ${sessionArchiveFileName}`);
    }
    if (!videoStat?.isFile()) {
      throw new Error(`Folder is missing ${recordingFileName}`);
    }

    const result = safeParseSessionArchiveJson(await readFile(eventsPath, "utf8"));

    if (!result.success) {
      throw new Error(`Invalid session bundle: ${result.error.message}`);
    }

    return { source: "local", archive: result.data, videoPath, notes: "" };
  }
}

export async function importZipBundle(zipBytes: Uint8Array): Promise<ViewerPayload> {
  return new DesktopZipSessionLoader().load(zipBytes);
}

export async function clearTempSession(tempId: string): Promise<void> {
  const entry = activeTempSessions.get(tempId);
  if (!entry) return;

  activeTempSessions.delete(tempId);
  await rm(entry.videoPath, { force: true });
}

export async function loadLocalSession(folderPath: string): Promise<ViewerPayload> {
  return new DesktopFilePathSessionLoader().load(folderPath);
}

export async function buildSessionZip(sessionFolderPath: string): Promise<Uint8Array> {
  const eventsPath = join(sessionFolderPath, sessionArchiveFileName);
  const videoPath = join(sessionFolderPath, recordingFileName);

  const [eventsBytes, webmBytes] = await Promise.all([readFile(eventsPath), readFile(videoPath)]);

  return zipSync({
    [sessionArchiveFileName]: new Uint8Array(eventsBytes),
    [recordingFileName]: new Uint8Array(webmBytes)
  });
}
