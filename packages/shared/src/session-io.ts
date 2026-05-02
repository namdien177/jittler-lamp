import { ZodError } from "zod/v4";

import { sessionArchiveSchema, type SessionArchive } from "./session";

export const sessionArchiveFileName = "session.archive.json";
export const recordingFileName = "recording.webm";

export type SessionBundleFiles = {
  archiveJson: Uint8Array;
  recordingWebm: Uint8Array;
};

export interface SessionLoader<TSource, TLoaded> {
  load(source: TSource): Promise<TLoaded> | TLoaded;
}

export interface SessionExporter<TInput, TOutput> {
  export(input: TInput): Promise<TOutput> | TOutput;
}

export function parseSessionArchiveJson(input: string | Uint8Array): SessionArchive {
  const jsonText = typeof input === "string" ? input : new TextDecoder().decode(input);
  return sessionArchiveSchema.parse(JSON.parse(jsonText));
}

export function safeParseSessionArchiveJson(input: string | Uint8Array): ReturnType<typeof sessionArchiveSchema.safeParse> {
  const jsonText = typeof input === "string" ? input : new TextDecoder().decode(input);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText) as unknown;
  } catch (e) {
    return {
      success: false,
      error: new ZodError([
        {
          code: "custom",
          input: jsonText,
          message: e instanceof Error ? e.message : "Invalid JSON",
          path: []
        }
      ]) as unknown as ZodError<SessionArchive>
    };
  }
  return sessionArchiveSchema.safeParse(raw);
}

export function pickSessionBundleFiles(files: Record<string, Uint8Array>): SessionBundleFiles {
  let archiveJson: Uint8Array | null = null;
  let recordingWebm: Uint8Array | null = null;

  for (const [path, content] of Object.entries(files)) {
    const name = path.split("/").pop();
    if (name === sessionArchiveFileName) archiveJson = content;
    if (name === recordingFileName) recordingWebm = content;
  }

  if (!archiveJson) {
    throw new Error(`${sessionArchiveFileName} not found in bundle.`);
  }

  if (!recordingWebm) {
    throw new Error(`${recordingFileName} not found in bundle.`);
  }

  return { archiveJson, recordingWebm };
}
