import type { ViewerPayload } from "../rpc";
import type { DesktopBridge } from "./desktop-bridge";

type MediaAttemptKind = "media-url";

type VideoEventLogEntry = {
  event: string;
  at: string;
  networkState: number;
  readyState: number;
  currentTime: number;
  currentSrcKind: string;
};

type VideoLoadAttempt = {
  videoPath: string;
  mimeType: string;
  source: ViewerPayload["source"] | "unknown";
  attemptKind: MediaAttemptKind;
  loadVersion: number;
};

export type VideoDiagnostics = {
  reason: string;
  requestedMimeType: string | null;
  canPlayRequestedType: string;
  canPlayWebm: string;
  canPlayVp8: string;
  canPlayVp9: string;
  lastAttempt: VideoLoadAttempt | null;
  error: {
    code: number | null;
    codeLabel: string;
    message: string | null;
  };
  networkState: number;
  readyState: number;
  currentTime: number;
  duration: number | null;
  paused: boolean;
  ended: boolean;
  src: string | null;
  currentSrc: string;
  currentSrcKind: string;
  recentEvents: VideoEventLogEntry[];
};

export type ViewerVideoState = {
  loadVersion: number;
  eventLog: VideoEventLogEntry[];
  lastLoadAttempt: VideoLoadAttempt | null;
};

export function createViewerVideoState(): ViewerVideoState {
  return {
    loadVersion: 0,
    eventLog: [],
    lastLoadAttempt: null
  };
}

export function resetViewerVideoDiagnostics(state: ViewerVideoState): void {
  state.eventLog = [];
  state.lastLoadAttempt = null;
}

export function recordViewerVideoEvent(viewerVideo: HTMLVideoElement, state: ViewerVideoState, event: string): void {
  state.eventLog.push({
    event,
    at: new Date().toISOString(),
    networkState: viewerVideo.networkState,
    readyState: viewerVideo.readyState,
    currentTime: viewerVideo.currentTime,
    currentSrcKind: classifyVideoSrc(viewerVideo.currentSrc)
  });

  if (state.eventLog.length > 20) {
    state.eventLog = state.eventLog.slice(-20);
  }
}

export function collectViewerVideoDiagnostics(
  viewerVideo: HTMLVideoElement,
  state: ViewerVideoState,
  reason: string
): VideoDiagnostics {
  const error = viewerVideo.error;

  return {
    reason,
    requestedMimeType: state.lastLoadAttempt?.mimeType ?? null,
    canPlayRequestedType: state.lastLoadAttempt?.mimeType
      ? viewerVideo.canPlayType(state.lastLoadAttempt.mimeType)
      : "",
    canPlayWebm: viewerVideo.canPlayType("video/webm"),
    canPlayVp8: viewerVideo.canPlayType("video/webm;codecs=vp8"),
    canPlayVp9: viewerVideo.canPlayType("video/webm;codecs=vp9"),
    lastAttempt: state.lastLoadAttempt,
    error: {
      code: error?.code ?? null,
      codeLabel: labelVideoErrorCode(error?.code ?? null),
      message: error?.message ?? null
    },
    networkState: viewerVideo.networkState,
    readyState: viewerVideo.readyState,
    currentTime: viewerVideo.currentTime,
    duration: Number.isFinite(viewerVideo.duration) ? viewerVideo.duration : null,
    paused: viewerVideo.paused,
    ended: viewerVideo.ended,
    src: viewerVideo.getAttribute("src"),
    currentSrc: viewerVideo.currentSrc,
    currentSrcKind: classifyVideoSrc(viewerVideo.currentSrc),
    recentEvents: [...state.eventLog]
  };
}

export async function loadViewerVideoSource(input: {
  videoPath: string;
  mimeType: string;
  viewerVideo: HTMLVideoElement;
  viewerVideoState: ViewerVideoState;
  desktopBridge: DesktopBridge | null;
  getViewerSource: () => ViewerPayload["source"] | "unknown";
  isViewerOpen: () => boolean;
  onBridgeUnavailable: () => void;
  onLoadFailure: (error: unknown, diagnostics: VideoDiagnostics) => void;
}): Promise<void> {
  const loadVersion = ++input.viewerVideoState.loadVersion;

  resetViewerVideoDiagnostics(input.viewerVideoState);
  input.viewerVideo.removeAttribute("src");
  input.viewerVideo.load();

  if (!input.desktopBridge) {
    input.onBridgeUnavailable();
    return;
  }

  try {
    logViewerVideoAttempt(input.viewerVideo, input.viewerVideoState, {
      videoPath: input.videoPath,
      mimeType: input.mimeType,
      source: input.getViewerSource(),
      attemptKind: "media-url",
      loadVersion
    });

    const { url } = await input.desktopBridge.rpc.request.getVideoPlaybackUrl({
      videoPath: input.videoPath,
      mimeType: input.mimeType
    });

    console.info("[jittle-lamp][viewer-video] fetched video bytes", {
      loadVersion,
      mimeType: input.mimeType,
      url
    });

    if (loadVersion !== input.viewerVideoState.loadVersion || !input.isViewerOpen()) {
      return;
    }

    input.viewerVideoState.lastLoadAttempt = {
      videoPath: input.videoPath,
      mimeType: input.mimeType,
      source: input.getViewerSource(),
      attemptKind: "media-url",
      loadVersion
    };
    input.viewerVideo.src = url;
    console.info(
      "[jittle-lamp][viewer-video] loading media url",
      collectViewerVideoDiagnostics(input.viewerVideo, input.viewerVideoState, "media-url-load")
    );
    input.viewerVideo.load();
  } catch (error) {
    input.onLoadFailure(
      error,
      collectViewerVideoDiagnostics(input.viewerVideo, input.viewerVideoState, "media-url-rpc-failure")
    );
  }
}

function logViewerVideoAttempt(
  viewerVideo: HTMLVideoElement,
  state: ViewerVideoState,
  input: VideoLoadAttempt
): void {
  state.lastLoadAttempt = input;
  console.info("[jittle-lamp][viewer-video] source attempt", {
    ...input,
    canPlayType: viewerVideo.canPlayType(input.mimeType),
    networkState: viewerVideo.networkState,
    readyState: viewerVideo.readyState,
    currentSrc: viewerVideo.currentSrc,
    currentSrcKind: classifyVideoSrc(viewerVideo.currentSrc)
  });
}

function labelVideoErrorCode(code: number | null): string {
  switch (code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "aborted";
    case MediaError.MEDIA_ERR_NETWORK:
      return "network";
    case MediaError.MEDIA_ERR_DECODE:
      return "decode";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "src-not-supported";
    default:
      return "unknown";
  }
}

function classifyVideoSrc(value: string): string {
  if (!value) return "empty";
  if (value.startsWith("blob:")) return "blob";
  if (value.startsWith("file:")) return "file";
  if (value.startsWith("http://") || value.startsWith("https://")) return "http";
  return "other";
}
