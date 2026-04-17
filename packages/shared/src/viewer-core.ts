import type { ActionMergeGroup, NetworkSubtype, SessionArchive } from "./session";
import { buildTimeline, type TimelineItem, type TimelineSection } from "./timeline";

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

export function resetViewerCoreState(state: ViewerCoreState): void {
  state.timeline = [];
  state.activeIndex = -1;
  state.networkDetailIndex = null;
  state.networkSearchQuery = "";
  state.mergeDialogOpen = false;
  state.mergeDialogValue = "";
  state.mergeDialogError = null;
  state.pendingMergeActionIds = [];
  state.activeSection = "actions";
  state.networkSubtypeFilter = "all";
  state.autoFollow = true;
  state.selectedActionIds = new Set();
  state.anchorActionId = null;
  state.mergeGroups = [];
}

export function applyArchiveToViewerCore(state: ViewerCoreState, archive: SessionArchive): void {
  state.timeline = buildTimeline(archive);
  state.activeIndex = -1;
  state.networkDetailIndex = null;
  state.networkSearchQuery = "";
  state.mergeDialogOpen = false;
  state.mergeDialogValue = "";
  state.mergeDialogError = null;
  state.pendingMergeActionIds = [];
  state.activeSection = "actions";
  state.networkSubtypeFilter = "all";
  state.autoFollow = true;
  state.selectedActionIds = new Set();
  state.anchorActionId = null;
  state.mergeGroups = (archive.annotations ?? []).filter(
    (annotation): annotation is ActionMergeGroup => annotation.kind === "merge-group"
  );
}
