import { createViewerCoreState, resetViewerCoreState, type SessionArchive, type ViewerCoreState } from "@jittle-lamp/shared";

export type FeedbackTone = "neutral" | "success" | "error";
export type AppPhase = "idle" | "loading" | "error" | "viewing";

export type AppState = ViewerCoreState & {
  phase: AppPhase;
  error: string | null;
  archive: SessionArchive | null;
  videoUrl: string | null;
  recordingBytes: Uint8Array | null;
  feedback: string | null;
  feedbackTone: FeedbackTone;
};

export const state: AppState = {
  ...createViewerCoreState(),
  phase: "idle",
  error: null,
  archive: null,
  videoUrl: null,
  recordingBytes: null,
  feedback: null,
  feedbackTone: "neutral"
};

export function setFeedback(text: string, tone: FeedbackTone): void {
  state.feedback = text;
  state.feedbackTone = tone;
}

export function resetViewerState(): void {
  state.phase = "idle";
  state.error = null;
  state.archive = null;
  state.videoUrl = null;
  state.recordingBytes = null;
  resetViewerCoreState(state);
  state.feedback = null;
  state.feedbackTone = "neutral";
}
