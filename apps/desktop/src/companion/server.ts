import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  companionServerOrigin,
  companionServerPort,
  isTrustedCompanionOrigin,
  loadResolvedCompanionConfig,
  type ResolvedCompanionConfig,
  resolveArtifactDestinationPath
} from "./config";

type CompanionServerOptions = {
  quiet?: boolean;
};

const corsHeaders = {
  "access-control-allow-methods": "GET,PUT,OPTIONS",
  "access-control-allow-headers": "content-type"
};

let activeServer: Bun.Server<undefined> | null = null;
let activeConfig: ResolvedCompanionConfig | null = null;

export async function getCompanionConfigState(): Promise<ResolvedCompanionConfig> {
  if (activeConfig) {
    return activeConfig;
  }

  activeConfig = await loadResolvedCompanionConfig();
  return activeConfig;
}

export async function refreshCompanionConfig(): Promise<ResolvedCompanionConfig> {
  activeConfig = await loadResolvedCompanionConfig();
  return activeConfig;
}

export async function startCompanionServer(options: CompanionServerOptions = {}): Promise<Bun.Server<undefined>> {
  if (activeServer) {
    return activeServer;
  }

  const initialConfig = await getCompanionConfigState();

  activeServer = Bun.serve({
    hostname: "127.0.0.1",
    port: companionServerPort,
    fetch: async (request) => {
      const url = new URL(request.url);
      const requestOrigin = request.headers.get("origin");

      if (request.method === "OPTIONS") {
        if (requestOrigin === null || !isTrustedCompanionOrigin(requestOrigin)) {
          return new Response(null, { status: 403 });
        }

        return new Response(null, {
          status: 204,
          headers: corsHeadersForOrigin(requestOrigin)
        });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        const config = await getCompanionConfigState();

        return jsonResponse({
          ok: true,
          outputDir: config.outputDir,
          origin: companionServerOrigin
        });
      }

      if (request.method === "GET" && url.pathname === "/config") {
        const config = await getCompanionConfigState();
        return jsonResponse(config);
      }

      const artifactMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(recording\.webm|session\.events\.json)$/);

      if (request.method === "PUT" && artifactMatch) {
        if (!isTrustedCompanionOrigin(requestOrigin)) {
          return jsonResponse({ ok: false, error: "Forbidden origin" }, 403);
        }

        const config = await getCompanionConfigState();

        const sessionId = artifactMatch[1];
        const artifactName = artifactMatch[2];

        if (!sessionId || !artifactName) {
          return jsonResponse({ ok: false, error: "Invalid artifact path" }, 400);
        }

        const destinationPath = resolveArtifactDestinationPath({
          outputDir: config.outputDir,
          sessionId,
          artifactName: artifactName as "recording.webm" | "session.events.json"
        });

        await mkdir(dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, Buffer.from(await request.arrayBuffer()));

        return jsonResponse({
          ok: true,
          destinationPath
        });
      }

      return jsonResponse({ ok: false, error: "Not found" }, 404);
    },
    error: (error) => jsonResponse({ ok: false, error: error.message }, 500)
  });

  if (!options.quiet) {
    console.info(`jittle-lamp companion listening on ${companionServerOrigin}`);
    console.info(`Writing session artifacts to ${initialConfig.outputDir}`);
  }

  return activeServer;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json"
    }
  });
}

function corsHeadersForOrigin(origin: string): Record<string, string> {
  return {
    ...corsHeaders,
    "access-control-allow-origin": origin
  };
}
