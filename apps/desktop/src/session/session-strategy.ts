import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { unzipSync } from "fflate";

import { recordingFileName, safeParseSessionArchiveJson, sessionArchiveFileName, type SessionLoader } from "@jittle-lamp/shared";

import type { ViewerPayload } from "../rpc";

export type DesktopSessionLoadMode = "local" | "zip" | "remote";

export type RemoteDesktopSessionRequest = {
  zipUrl: string;
  authToken?: string;
};

export type TempSessionRegistry = Map<string, { videoPath: string }>;

export interface DesktopSessionStrategy<TInput> extends SessionLoader<TInput, ViewerPayload> {
  readonly mode: DesktopSessionLoadMode;
}

export class ZipBytesDesktopSessionStrategy implements DesktopSessionStrategy<Uint8Array> {
  readonly mode = "zip" as const;

  constructor(private readonly activeTempSessions: TempSessionRegistry) {}

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

    this.activeTempSessions.set(tempId, { videoPath });

    return { source: "zip", archive: bundle, videoPath, notes: "", tempId };
  }
}

export class LocalFolderDesktopSessionStrategy implements DesktopSessionStrategy<string> {
  readonly mode = "local" as const;

  async load(folderPath: string): Promise<ViewerPayload> {
    const eventsPath = join(folderPath, sessionArchiveFileName);
    const videoPath = join(folderPath, recordingFileName);

    const [eventsStat, videoStat] = await Promise.all([stat(eventsPath).catch(() => null), stat(videoPath).catch(() => null)]);

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

export class RemoteZipDesktopSessionStrategy implements DesktopSessionStrategy<RemoteDesktopSessionRequest> {
  readonly mode = "remote" as const;

  constructor(private readonly zipStrategy: ZipBytesDesktopSessionStrategy) {}

  async load(input: RemoteDesktopSessionRequest): Promise<ViewerPayload> {
    const headers = new Headers();

    if (input.authToken) {
      headers.set("authorization", `Bearer ${input.authToken}`);
    }

    const response = await fetch(input.zipUrl, { headers });

    if (!response.ok) {
      throw new Error(`Unable to load remote ZIP (${response.status}).`);
    }

    return this.zipStrategy.load(new Uint8Array(await response.arrayBuffer()));
  }
}

export function createDesktopSessionStrategies(activeTempSessions: TempSessionRegistry): {
  local: LocalFolderDesktopSessionStrategy;
  zip: ZipBytesDesktopSessionStrategy;
  remote: RemoteZipDesktopSessionStrategy;
} {
  const zip = new ZipBytesDesktopSessionStrategy(activeTempSessions);

  return {
    local: new LocalFolderDesktopSessionStrategy(),
    zip,
    remote: new RemoteZipDesktopSessionStrategy(zip)
  };
}
