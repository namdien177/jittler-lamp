import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { strFromU8, unzipSync, zipSync } from "fflate";

import { sessionBundleSchema } from "@jittle-lamp/shared";

import type { ViewerPayload } from "../rpc";

const activeTempSessions = new Map<string, { videoPath: string }>();

export async function importZipBundle(zipBytes: Uint8Array): Promise<ViewerPayload> {
  const files = unzipSync(zipBytes);

  const eventsEntry = files["session.events.json"];
  const webmEntry = files["recording.webm"];

  if (!eventsEntry) {
    throw new Error("ZIP is missing session.events.json");
  }
  if (!webmEntry) {
    throw new Error("ZIP is missing recording.webm");
  }

  const raw = JSON.parse(strFromU8(eventsEntry)) as unknown;
  const result = sessionBundleSchema.safeParse(raw);

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

  return { source: "zip", bundle, videoPath, notes: "", tempId };
}

export async function clearTempSession(tempId: string): Promise<void> {
  const entry = activeTempSessions.get(tempId);
  if (!entry) return;

  activeTempSessions.delete(tempId);
  await rm(entry.videoPath, { force: true });
}

export async function loadLocalSession(folderPath: string): Promise<ViewerPayload> {
  const eventsPath = join(folderPath, "session.events.json");
  const videoPath = join(folderPath, "recording.webm");

  const [eventsStat, videoStat] = await Promise.all([
    stat(eventsPath).catch(() => null),
    stat(videoPath).catch(() => null)
  ]);

  if (!eventsStat?.isFile()) {
    throw new Error("Folder is missing session.events.json");
  }
  if (!videoStat?.isFile()) {
    throw new Error("Folder is missing recording.webm");
  }

  const raw = JSON.parse(await readFile(eventsPath, "utf8")) as unknown;
  const result = sessionBundleSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(`Invalid session bundle: ${result.error.message}`);
  }

  return { source: "local", bundle: result.data, videoPath, notes: "" };
}

export async function buildSessionZip(sessionFolderPath: string): Promise<Uint8Array> {
  const eventsPath = join(sessionFolderPath, "session.events.json");
  const videoPath = join(sessionFolderPath, "recording.webm");

  const [eventsBytes, webmBytes] = await Promise.all([readFile(eventsPath), readFile(videoPath)]);

  return zipSync({
    "session.events.json": new Uint8Array(eventsBytes),
    "recording.webm": new Uint8Array(webmBytes)
  });
}
