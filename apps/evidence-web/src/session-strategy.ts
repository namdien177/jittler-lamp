import type { SessionLoader } from "@jittle-lamp/shared";

import { loadSessionZip, type LoadedSession } from "./loader";

export type WebSessionLoadMode = "local" | "remote";

export type RemoteSessionRequest = {
  zipUrl: string;
  authToken?: string;
};

export interface WebSessionStrategy<TInput> extends SessionLoader<TInput, LoadedSession> {
  readonly mode: WebSessionLoadMode;
}

export class LocalZipWebSessionStrategy implements WebSessionStrategy<File> {
  readonly mode = "local" as const;

  async load(file: File): Promise<LoadedSession> {
    return loadSessionZip(file);
  }
}

export class RemoteZipWebSessionStrategy implements WebSessionStrategy<RemoteSessionRequest> {
  readonly mode = "remote" as const;

  async load(input: RemoteSessionRequest): Promise<LoadedSession> {
    const headers = new Headers();

    if (input.authToken) {
      headers.set("authorization", `Bearer ${input.authToken}`);
    }

    const response = await fetch(input.zipUrl, { headers });

    if (!response.ok) {
      throw new Error(`Unable to load remote ZIP (${response.status}).`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const file = new File([bytes], "remote-session.zip", { type: "application/zip" });
    return loadSessionZip(file);
  }
}

export function createWebSessionStrategies(): {
  local: LocalZipWebSessionStrategy;
  remote: RemoteZipWebSessionStrategy;
} {
  return {
    local: new LocalZipWebSessionStrategy(),
    remote: new RemoteZipWebSessionStrategy()
  };
}
