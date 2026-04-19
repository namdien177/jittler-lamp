import type { ArchiveAnnotation } from "@jittle-lamp/shared";
import type { NotesAdapter, PlaybackAdapter, ShareAdapter, StorageAdapter, ViewerAdapters } from "@jittle-lamp/viewer-core";

import type { ViewerPayload } from "../rpc";
import type { DesktopBridge } from "./desktop-bridge";
import { loadViewerVideoSource, type ViewerVideoState } from "./viewer-video";
import { canEditViewerNotes, getViewerReadOnlyNotice, type ViewerSource } from "./viewer-source";

export type DesktopViewerAdapters = ViewerAdapters<ViewerPayload, ViewerSource>;

export function createDesktopStorageAdapter(bridge: DesktopBridge): StorageAdapter<ViewerPayload> {
  return {
    importZipSession: () => bridge.rpc.request.importZipSession(undefined),
    openLocalSession: () => bridge.rpc.request.openLocalSession(undefined),
    loadLibrarySession: (sessionId) => bridge.rpc.request.loadLibrarySession({ sessionId }),
    saveSessionReviewState: (args: { sessionId: string; notes: string; annotations: ArchiveAnnotation[] }) =>
      bridge.rpc.request.saveSessionReviewState(args),
    exportSessionZip: (sessionId) => bridge.rpc.request.exportSessionZip({ sessionId })
  };
}

export function createDesktopPlaybackAdapter(args: {
  bridge: DesktopBridge;
  viewerVideo: HTMLVideoElement;
  viewerVideoState: ViewerVideoState;
  getViewerSource: () => ViewerPayload["source"] | "unknown";
  isViewerOpen: () => boolean;
}): PlaybackAdapter {
  return {
    loadSource: ({ videoPath, mimeType, onBridgeUnavailable, onLoadFailure }) => {
      void loadViewerVideoSource({
        videoPath,
        mimeType,
        viewerVideo: args.viewerVideo,
        viewerVideoState: args.viewerVideoState,
        desktopBridge: args.bridge,
        getViewerSource: args.getViewerSource,
        isViewerOpen: args.isViewerOpen,
        onBridgeUnavailable: onBridgeUnavailable ?? (() => {}),
        onLoadFailure: onLoadFailure ?? (() => {})
      });
    },
    releaseSource: () => {
      args.viewerVideo.pause();
      args.viewerVideo.src = "";
    }
  };
}

export function createDesktopNotesAdapter(): NotesAdapter<ViewerSource> {
  return {
    canEdit: canEditViewerNotes,
    getReadOnlyNotice: getViewerReadOnlyNotice
  };
}

export function createDesktopShareAdapter(): ShareAdapter {
  return {};
}
