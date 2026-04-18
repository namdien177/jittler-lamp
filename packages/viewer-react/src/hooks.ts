import { useMemo } from "react";

import type { NetworkSubtype, TimelineItem } from "@jittle-lamp/shared";
import {
  deriveSectionTimeline,
  type AppPhase,
  type FeedbackTone,
  type ViewerCoreState,
  type ViewerPhaseState
} from "@jittle-lamp/viewer-core";
import type { SessionArchive } from "@jittle-lamp/shared";

export type ViewerShellController = {
  phase: AppPhase;
  error: string | null;
  canRenderContent: boolean;
};

export function useViewerShell(phaseState: ViewerPhaseState): ViewerShellController {
  return useMemo(
    () => ({
      phase: phaseState.phase,
      error: phaseState.error,
      canRenderContent: phaseState.phase === "viewing"
    }),
    [phaseState.error, phaseState.phase]
  );
}

export type TimelinePaneController = {
  items: TimelineItem[];
  activeIndex: number;
  selectedActionIds: Set<string>;
  autoFollow: boolean;
};

export function useTimelinePane(state: Pick<ViewerCoreState, "timeline" | "activeIndex" | "selectedActionIds" | "autoFollow">): TimelinePaneController {
  return useMemo(
    () => ({
      items: state.timeline,
      activeIndex: state.activeIndex,
      selectedActionIds: state.selectedActionIds,
      autoFollow: state.autoFollow
    }),
    [state.activeIndex, state.autoFollow, state.selectedActionIds, state.timeline]
  );
}

export type NetworkPaneController = {
  items: TimelineItem[];
  activeIndex: number;
  detailIndex: number | null;
  searchQuery: string;
  subtypeFilter: NetworkSubtype | "all";
};

export function useNetworkPane(args: {
  archive: SessionArchive;
  detailIndex: number | null;
  activeIndex: number;
  searchQuery: string;
  subtypeFilter: NetworkSubtype | "all";
}): NetworkPaneController {
  const items = useMemo(
    () => deriveSectionTimeline(args.archive, "network", args.subtypeFilter, args.searchQuery),
    [args.archive, args.searchQuery, args.subtypeFilter]
  );

  return useMemo(
    () => ({
      items,
      detailIndex: args.detailIndex,
      activeIndex: args.activeIndex,
      searchQuery: args.searchQuery,
      subtypeFilter: args.subtypeFilter
    }),
    [args.activeIndex, args.detailIndex, args.searchQuery, args.subtypeFilter, items]
  );
}

export type MergeDialogController = {
  isOpen: boolean;
  value: string;
  error: string | null;
  selectedCount: number;
};

export function useMergeDialog(state: Pick<ViewerCoreState, "mergeDialogOpen" | "mergeDialogValue" | "mergeDialogError" | "pendingMergeActionIds">): MergeDialogController {
  return useMemo(
    () => ({
      isOpen: state.mergeDialogOpen,
      value: state.mergeDialogValue,
      error: state.mergeDialogError,
      selectedCount: state.pendingMergeActionIds.length
    }),
    [state.mergeDialogError, state.mergeDialogOpen, state.mergeDialogValue, state.pendingMergeActionIds.length]
  );
}

export type FeedbackBannerController = {
  isVisible: boolean;
  message: string;
  tone: FeedbackTone;
};

export function useFeedbackBanner(args: { message: string | null; tone?: FeedbackTone }): FeedbackBannerController {
  return useMemo(
    () => ({
      isVisible: Boolean(args.message),
      message: args.message ?? "",
      tone: args.tone ?? "neutral"
    }),
    [args.message, args.tone]
  );
}
