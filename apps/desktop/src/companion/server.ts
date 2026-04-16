import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { initSessionsDb, insertSessionWrite, removeSessionRecords } from "./sessions-db";

import {
  companionServerOrigin,
  companionServerPort,
  isTrustedCompanionOrigin,
  loadResolvedCompanionConfig,
  type ResolvedCompanionConfig,
  resolveArtifactDestinationPath
} from "./config";

type ArtifactName = "recording.webm" | "session.events.json";

type CompanionServerOptions = {
  quiet?: boolean;
};

export type CompanionServerStatus = "starting" | "listening" | "error";

export type CompanionArtifactWrite = {
  id: string;
  at: string;
  sessionId: string;
  artifactName: ArtifactName;
  destinationPath: string;
  bytes: number;
};

export type CompanionRuntimeState = {
  status: CompanionServerStatus;
  origin: string;
  outputDir: string | null;
  lastError: string | null;
  recentWrites: CompanionArtifactWrite[];
};

const corsBaseHeaders = {
  "access-control-allow-methods": "GET,PUT,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const recentWritesLimit = 12;
const mediaRegistry = new Map<string, { filePath: string; mimeType: string }>();

let activeServer: Bun.Server<undefined> | null = null;
let activeConfig: ResolvedCompanionConfig | null = null;
let runtimeState: CompanionRuntimeState = {
  status: "starting",
  origin: companionServerOrigin,
  outputDir: null,
  lastError: null,
  recentWrites: []
};

export async function getCompanionConfigState(): Promise<ResolvedCompanionConfig> {
  if (activeConfig) {
    return activeConfig;
  }

  activeConfig = await loadResolvedCompanionConfig();
  runtimeState = {
    ...runtimeState,
    outputDir: activeConfig.outputDir
  };
  return activeConfig;
}

export async function refreshCompanionConfig(): Promise<ResolvedCompanionConfig> {
  activeConfig = await loadResolvedCompanionConfig();
  runtimeState = {
    ...runtimeState,
    outputDir: activeConfig.outputDir
  };
  return activeConfig;
}

export async function getCompanionRuntimeState(): Promise<CompanionRuntimeState> {
  const config = await getCompanionConfigState();

  return {
    ...runtimeState,
    outputDir: config.outputDir,
    recentWrites: [...runtimeState.recentWrites]
  };
}

export async function startCompanionServer(options: CompanionServerOptions = {}): Promise<Bun.Server<undefined>> {
  if (activeServer) {
    return activeServer;
  }

  await initSessionsDb();

  const initialConfig = await getCompanionConfigState();

  runtimeState = {
    ...runtimeState,
    status: "starting",
    outputDir: initialConfig.outputDir,
    lastError: null
  };

  try {
    activeServer = Bun.serve({
      hostname: "127.0.0.1",
      port: companionServerPort,
      fetch: (request) => handleCompanionRequest(request),
      error: (error) => jsonResponse({ ok: false, error: error.message }, 500)
    });

    runtimeState = {
      ...runtimeState,
      status: "listening",
      outputDir: initialConfig.outputDir,
      lastError: null
    };

    if (!options.quiet) {
      console.info(`jittle-lamp companion listening on ${companionServerOrigin}`);
      console.info(`Writing session artifacts to ${initialConfig.outputDir}`);
    }

    return activeServer;
  } catch (error: unknown) {
    runtimeState = {
      ...runtimeState,
      status: "error",
      lastError: errorMessage(error)
    };
    throw error;
  }
}

export async function handleCompanionRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestOrigin = request.headers.get("origin");

  try {
    if (request.method === "OPTIONS") {
      if (requestOrigin === null || !isTrustedCompanionOrigin(requestOrigin)) {
        return new Response(null, { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: corsHeadersForOrigin(requestOrigin, request)
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const config = await getCompanionConfigState();

      return jsonResponse(
        {
          ok: true,
          outputDir: config.outputDir,
          origin: companionServerOrigin
        },
        200,
        requestOrigin
      );
    }

    if (request.method === "GET" && url.pathname === "/config") {
      const config = await getCompanionConfigState();
      return jsonResponse(config, 200, requestOrigin);
    }

    const mediaMatch = url.pathname.match(/^\/api\/media\/([^/]+)$/);

    if (request.method === "GET" && mediaMatch?.[1]) {
      return serveRegisteredMedia(mediaMatch[1], request);
    }

    const artifactMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(recording\.webm|session\.events\.json)$/);

    if (request.method === "PUT" && artifactMatch) {
      if (!isTrustedCompanionOrigin(requestOrigin)) {
        return jsonResponse({ ok: false, error: "Forbidden origin" }, 403, requestOrigin);
      }

      const config = await getCompanionConfigState();

      const sessionId = artifactMatch[1];
      const artifactName = artifactMatch[2] as ArtifactName;

      if (!sessionId || !artifactName) {
        return jsonResponse({ ok: false, error: "Invalid artifact path" }, 400, requestOrigin);
      }

      const destinationPath = resolveArtifactDestinationPath({
        outputDir: config.outputDir,
        sessionId,
        artifactName
      });

      const bytes = Buffer.from(await request.arrayBuffer());

      await mkdir(dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, bytes);

      recordArtifactWrite({
        sessionId,
        artifactName,
        destinationPath,
        bytes: bytes.byteLength
      });

      return jsonResponse(
        {
          ok: true,
          destinationPath
        },
        200,
        requestOrigin
      );
    }

    return jsonResponse({ ok: false, error: "Not found" }, 404, requestOrigin);
  } catch (error: unknown) {
    return jsonResponse({ ok: false, error: errorMessage(error) }, 500, requestOrigin);
  }
}

export function registerMediaPlayback(input: { filePath: string; mimeType: string }): string {
  const mediaId = crypto.randomUUID();
  mediaRegistry.set(mediaId, {
    filePath: resolve(input.filePath),
    mimeType: input.mimeType || "application/octet-stream"
  });
  return `${companionServerOrigin}/api/media/${mediaId}`;
}

async function serveRegisteredMedia(mediaId: string, request: Request): Promise<Response> {
  const entry = mediaRegistry.get(mediaId);

  if (!entry) {
    return jsonResponse({ ok: false, error: "Media not found" }, 404);
  }

  const fileStat = await stat(entry.filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    mediaRegistry.delete(mediaId);
    return jsonResponse({ ok: false, error: "Media file is missing" }, 404);
  }

  const totalBytes = fileStat.size;
  const rangeHeader = requestRangeHeader();

  if (!rangeHeader) {
    return new Response(Bun.file(entry.filePath), {
      status: 200,
      headers: {
        "accept-ranges": "bytes",
        "content-length": String(totalBytes),
        "content-type": entry.mimeType
      }
    });
  }

  const range = parseByteRange(rangeHeader, totalBytes);

  if (!range) {
    return new Response(null, {
      status: 416,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes */${totalBytes}`,
        "content-type": entry.mimeType
      }
    });
  }

  return new Response(Bun.file(entry.filePath).slice(range.start, range.end + 1), {
    status: 206,
    headers: {
      "accept-ranges": "bytes",
      "content-length": String(range.end - range.start + 1),
      "content-range": `bytes ${range.start}-${range.end}/${totalBytes}`,
      "content-type": entry.mimeType
    }
  });

  function requestRangeHeader(): string | null {
    return request.headers.get("range");
  }
}

function parseByteRange(rangeHeader: string, totalBytes: number): { start: number; end: number } | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) {
    return null;
  }

  const [, startText, endText] = match;

  if (startText === "" && endText === "") {
    return null;
  }

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(totalBytes - suffixLength, 0);
    return { start, end: totalBytes - 1 };
  }

  const start = Number(startText);
  if (!Number.isFinite(start) || start < 0 || start >= totalBytes) {
    return null;
  }

  const end = endText === "" ? totalBytes - 1 : Number(endText);
  if (!Number.isFinite(end) || end < start) {
    return null;
  }

  return {
    start,
    end: Math.min(end, totalBytes - 1)
  };
}

export function _testResetCompanionMediaRegistry(): void {
  mediaRegistry.clear();
}

function recordArtifactWrite(input: {
  sessionId: string;
  artifactName: ArtifactName;
  destinationPath: string;
  bytes: number;
}): void {
  const entry: CompanionArtifactWrite = {
    id: `${input.sessionId}:${input.artifactName}:${Date.now()}`,
    at: new Date().toISOString(),
    sessionId: input.sessionId,
    artifactName: input.artifactName,
    destinationPath: input.destinationPath,
    bytes: input.bytes
  };

  insertSessionWrite({
    id: entry.id,
    sessionId: entry.sessionId,
    artifactName: entry.artifactName,
    destinationPath: entry.destinationPath,
    sessionFolder: dirname(entry.destinationPath),
    bytes: entry.bytes,
    at: entry.at
  });

  runtimeState = {
    ...runtimeState,
    status: "listening",
    lastError: null,
    recentWrites: [entry, ...runtimeState.recentWrites].slice(0, recentWritesLimit)
  };
}

function jsonResponse(payload: unknown, status = 200, requestOrigin?: string | null): Response {
  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    status,
    headers: {
      ...corsHeadersForOrigin(requestOrigin ?? null),
      "content-type": "application/json"
    }
  });
}

function corsHeadersForOrigin(origin: string | null, request?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    ...corsBaseHeaders
  };

  if (typeof origin === "string" && isTrustedCompanionOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }

  if (request?.headers.get("access-control-request-private-network") === "true") {
    headers["access-control-allow-private-network"] = "true";
  }

  return headers;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const config = await getCompanionConfigState();

  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId}`);
  }

  const sessionFolder = resolve(config.outputDir, sessionId);

  if (sessionFolder === config.outputDir || !sessionFolder.startsWith(`${config.outputDir}${sep}`)) {
    throw new Error("Resolved session folder escapes the configured output directory.");
  }

  await rm(sessionFolder, { recursive: true, force: true });
  removeSessionRecords(sessionId);

  runtimeState = {
    ...runtimeState,
    recentWrites: runtimeState.recentWrites.filter((w) => w.sessionId !== sessionId)
  };
}
