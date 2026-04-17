import {
  buildSectionTimeline,
  buildTimeline,
  buildVisibleActionRangeSelection,
  getContiguousMergeableActionIds,
  type TimelineItem,
  type TimelineSection
} from "@jittle-lamp/shared";
import type { ActionMergeGroup, NetworkSubtype, SessionArchive } from "@jittle-lamp/shared";

export type FeedbackTone = "neutral" | "success" | "error";
export type AppPhase = "idle" | "loading" | "error" | "viewing";

export type ViewerCoreState = {
  timeline: TimelineItem[];
  activeIndex: number;
  networkDetailIndex: number | null;
  networkSearchQuery: string;
  mergeDialogOpen: boolean;
  mergeDialogValue: string;
  mergeDialogError: string | null;
  pendingMergeActionIds: string[];
  activeSection: TimelineSection;
  networkSubtypeFilter: NetworkSubtype | "all";
  autoFollow: boolean;
  selectedActionIds: Set<string>;
  anchorActionId: string | null;
  mergeGroups: ActionMergeGroup[];
};

export type SelectionCommand = {
  selectedActionIds: Set<string>;
  anchorActionId: string | null;
};

export type MergeDialogCommandResult =
  | { ok: true; label: string; selectedActionIds: string[] }
  | { ok: false; error: string };

export type ViewerPhaseState = {
  phase: AppPhase;
  error: string | null;
};

export function createViewerCoreState(): ViewerCoreState {
  return {
    timeline: [],
    activeIndex: -1,
    networkDetailIndex: null,
    networkSearchQuery: "",
    mergeDialogOpen: false,
    mergeDialogValue: "",
    mergeDialogError: null,
    pendingMergeActionIds: [],
    activeSection: "actions",
    networkSubtypeFilter: "all",
    autoFollow: true,
    selectedActionIds: new Set(),
    anchorActionId: null,
    mergeGroups: []
  };
}

export function reduceViewerPhase(
  _state: ViewerPhaseState,
  action: { type: "load:start" } | { type: "load:success" } | { type: "load:error"; error: string } | { type: "reset" }
): ViewerPhaseState {
  switch (action.type) {
    case "load:start":
      return { phase: "loading", error: null };
    case "load:success":
      return { phase: "viewing", error: null };
    case "load:error":
      return { phase: "error", error: action.error };
    case "reset":
      return { phase: "idle", error: null };
  }
}

export function resetViewerCoreState(state: ViewerCoreState): void {
  Object.assign(state, createViewerCoreState());
}

export function applyArchiveToViewerCore(state: ViewerCoreState, archive: SessionArchive): void {
  resetViewerCoreState(state);
  state.timeline = deriveTimeline(archive);
  state.mergeGroups = getArchiveMergeGroups(archive);
}

export function deriveTimeline(archive: SessionArchive): TimelineItem[] {
  return buildTimeline(archive);
}

export function deriveSectionTimeline(
  archive: SessionArchive,
  section: TimelineSection,
  subtypeFilter: NetworkSubtype | "all" = "all",
  networkSearchQuery = ""
): TimelineItem[] {
  return buildSectionTimeline(archive, section, subtypeFilter, networkSearchQuery);
}

export function deriveVisibleActionRange(
  archive: SessionArchive,
  mergeGroups: ReadonlyArray<ActionMergeGroup>,
  anchorId: string,
  targetId: string
): string[] {
  return buildVisibleActionRangeSelection(archive, mergeGroups, anchorId, targetId);
}

export function getContiguousMergeableSelection(
  archive: SessionArchive,
  mergeGroups: ReadonlyArray<ActionMergeGroup>,
  selectedIds: Iterable<string>
): string[] {
  return getContiguousMergeableActionIds(archive, mergeGroups, selectedIds);
}

export function selectSingleAction(itemId: string): SelectionCommand {
  return { selectedActionIds: new Set([itemId]), anchorActionId: itemId };
}

export function toggleActionSelection(current: SelectionCommand, itemId: string): SelectionCommand {
  const next = new Set(current.selectedActionIds);
  let anchorActionId = current.anchorActionId;
  if (next.has(itemId)) {
    next.delete(itemId);
  } else {
    next.add(itemId);
    anchorActionId = itemId;
  }
  return { selectedActionIds: next, anchorActionId };
}

export function selectActionRange(
  archive: SessionArchive,
  mergeGroups: ReadonlyArray<ActionMergeGroup>,
  current: SelectionCommand,
  targetId: string
): SelectionCommand {
  if (!current.anchorActionId) {
    return current;
  }

  const rangeIds = deriveVisibleActionRange(archive, mergeGroups, current.anchorActionId, targetId);
  if (rangeIds.length === 0) {
    return current;
  }

  return { selectedActionIds: new Set(rangeIds), anchorActionId: current.anchorActionId };
}

export function openMergeDialog(state: ViewerCoreState, selectedActionIds: string[]): void {
  state.pendingMergeActionIds = [...selectedActionIds];
  state.mergeDialogValue = `Merged ${selectedActionIds.length} actions`;
  state.mergeDialogError = null;
  state.mergeDialogOpen = true;
}

export function closeMergeDialog(state: ViewerCoreState): void {
  state.mergeDialogOpen = false;
  state.mergeDialogValue = "";
  state.mergeDialogError = null;
  state.pendingMergeActionIds = [];
}

export function validateMergeDialog(state: ViewerCoreState): MergeDialogCommandResult {
  if (state.pendingMergeActionIds.length < 2) {
    return { ok: false, error: "Select at least two actions before merging." };
  }

  const label = state.mergeDialogValue.trim();
  if (!label) {
    return { ok: false, error: "Enter a name for the merged action." };
  }

  return {
    ok: true,
    label,
    selectedActionIds: [...state.pendingMergeActionIds]
  };
}

export function createMergeGroup(args: {
  id: string;
  createdAt: string;
  label: string;
  selectedActionIds: string[];
}): ActionMergeGroup {
  return {
    id: args.id,
    kind: "merge-group",
    memberIds: [...args.selectedActionIds],
    tags: [],
    label: args.label,
    createdAt: args.createdAt
  };
}

export function getArchiveMergeGroups(archive: SessionArchive): ActionMergeGroup[] {
  return (archive.annotations ?? []).filter((annotation): annotation is ActionMergeGroup => annotation.kind === "merge-group");
}
