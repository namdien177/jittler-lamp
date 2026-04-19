import type { ActionMergeGroup, SessionArchive } from "@jittle-lamp/shared";
import type { NotesAdapter, PlaybackAdapter, ShareAdapter, StorageAdapter, ViewerAdapters } from "@jittle-lamp/viewer-core";

import { buildReviewedSessionZip } from "./archive-export";
import { loadSessionZip } from "./loader";
import { createWebSessionStrategies } from "./session-strategy";

export type WebLoadedSession = Awaited<ReturnType<typeof loadSessionZip>>;
export type WebViewerAdapters = ViewerAdapters<WebLoadedSession, "web">;

export function createWebStorageAdapter(): StorageAdapter<WebLoadedSession> {
  const strategies = createWebSessionStrategies();

  return {
    loadFromZipFile: (file) => strategies.local.load(file)
  };
}

export function createWebPlaybackAdapter(): PlaybackAdapter {
  let objectUrl: string | null = null;

  return {
    loadSource: ({ videoPath }) => {
      objectUrl = videoPath;
    },
    releaseSource: (args) => {
      const targetUrl = args?.videoPath ?? objectUrl;
      if (!targetUrl) return;

      URL.revokeObjectURL(targetUrl);
      if (targetUrl === objectUrl) objectUrl = null;
    }
  };
}

export function createWebShareAdapter(): ShareAdapter {
  return {};
}

export function createWebNotesAdapter(): NotesAdapter<"web"> {
  return {
    canEdit: () => false,
    getReadOnlyNotice: () => "Notes are read-only in web evidence mode."
  };
}

export function buildReviewedZipBlob(args: {
  archive: SessionArchive;
  mergeGroups: ActionMergeGroup[];
  recordingBytes: Uint8Array;
}): Blob {
  const zipBytes = buildReviewedSessionZip({
    archive: args.archive,
    mergeGroups: args.mergeGroups,
    recordingBytes: args.recordingBytes
  });

  return new Blob([Uint8Array.from(zipBytes).buffer], { type: "application/zip" });
}
