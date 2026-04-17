import { applyArchiveToViewerCore, createViewerCoreState, resetViewerCoreState, type ViewerCoreState } from "@jittle-lamp/viewer-core";

import type { ViewerPayload } from "../rpc";

export type ViewerState = ViewerCoreState & {
  open: boolean;
  payload: ViewerPayload | null;
  notesValue: string;
  notesSaving: boolean;
  notesDirty: boolean;
  isOpening: boolean;
};

export function createViewerState(): ViewerState {
  return {
    ...createViewerCoreState(),
    open: false,
    payload: null,
    notesValue: "",
    notesSaving: false,
    notesDirty: false,
    isOpening: false
  };
}

export function applyViewerPayload(state: ViewerState, payload: ViewerPayload): void {
  state.open = true;
  state.payload = payload;
  applyArchiveToViewerCore(state, payload.archive);
  state.notesValue = payload.notes;
  state.notesDirty = false;
  state.notesSaving = false;
}

export function resetViewerState(state: ViewerState): void {
  state.open = false;
  state.payload = null;
  resetViewerCoreState(state);
  state.notesValue = "";
  state.notesDirty = false;
  state.notesSaving = false;
}
