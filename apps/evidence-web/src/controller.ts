import type { SessionArchive, TimelineSection } from "@jittle-lamp/shared";
import { createMergeGroup, getContiguousMergeableSelection, openMergeDialog as openMergeDialogState, closeMergeDialog as closeMergeDialogState, selectActionRange, selectSingleAction, toggleActionSelection, validateMergeDialog, reduceViewerPhase } from "@jittle-lamp/viewer-core";

import { buildReviewedArchive, buildReviewedSessionZip } from "./archive-export";
import { loadSessionZip } from "./loader";
import { render, renderFeedback, updateTimelineHighlight } from "./render";
import { resetViewerState, setFeedback, state } from "./viewer-state";

let appRoot: HTMLElement;
let videoEl: HTMLVideoElement | null = null;
let delegatedEventsBound = false;
const scrollState = { isAutoScrolling: false };

let ctxTargetId: string | null = null;

export function init(): void {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Evidence web root element was not found.");
  }

  appRoot = root;
  bindDelegatedEvents();
  renderApp();
}

async function handleFile(file: File): Promise<void> {
  if (state.phase === "loading") return;

  const nextPhase = reduceViewerPhase(state, { type: "load:start" });
  state.phase = nextPhase.phase;
  state.error = nextPhase.error;
  renderApp();

  try {
    const loaded = await loadSessionZip(file);

    if (state.videoUrl) {
      URL.revokeObjectURL(state.videoUrl);
    }

    state.archive = loaded.archive;
    state.videoUrl = loaded.videoUrl;
    state.recordingBytes = loaded.recordingBytes;
    state.timeline = loaded.timeline;
    state.activeIndex = -1;
    state.networkDetailIndex = null;
    state.networkSearchQuery = "";
    state.activeSection = "actions";
    state.networkSubtypeFilter = "all";
    state.autoFollow = true;
    state.selectedActionIds = new Set();
    state.anchorActionId = null;
    state.mergeGroups = loaded.mergeGroups;
    state.phase = reduceViewerPhase(state, { type: "load:success" }).phase;
    state.feedback = null;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const nextPhase = reduceViewerPhase(state, { type: "load:error", error: errorMessage });
    state.phase = nextPhase.phase;
    state.error = nextPhase.error;
  }

  renderApp();
}

function renderApp(): void {
  render(state, appRoot);
  videoEl = appRoot.querySelector<HTMLVideoElement>("[data-role='viewer-video']");
  if (videoEl) {
    videoEl.removeEventListener("timeupdate", handleVideoTimeUpdate);
    videoEl.addEventListener("timeupdate", handleVideoTimeUpdate);
  }

  bindDropZoneEvents();
}

function handleVideoTimeUpdate(): void {
  if (!videoEl) return;
  updateTimelineHighlight(state, appRoot, videoEl, scrollState);
}

function bindDelegatedEvents(): void {
  if (delegatedEventsBound) {
    return;
  }

  delegatedEventsBound = true;

  appRoot.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const menu = appRoot.querySelector<HTMLElement>("[data-role='viewer-context-menu']");
    if (menu && !menu.hidden) {
      if (!menu.contains(target)) {
        hideContextMenu();
        return;
      }
    }

    const btn = target.closest<HTMLButtonElement>("[data-role]");
    if (!btn) return;

    const role = btn.dataset.role;

    if (role === "btn-close") {
      if (state.videoUrl) {
        URL.revokeObjectURL(state.videoUrl);
      }
      resetViewerState();
      renderApp();
      return;
    }

    if (role === "btn-export") {
      downloadUpdatedZip();
      return;
    }

    if (role === "viewer-merge-dialog-backdrop" && target === btn) {
      closeMergeDialog();
      return;
    }

    if (role === "viewer-merge-dialog-cancel") {
      closeMergeDialog();
      return;
    }

    if (role === "viewer-merge-dialog-confirm") {
      submitMergeDialog();
      return;
    }

    if (role === "btn-close-detail") {
      state.networkDetailIndex = null;
      renderApp();
      return;
    }

    if (role === "section-tab") {
      const section = btn.dataset.section as TimelineSection | undefined;
      if (!section) return;
      state.activeSection = section;
      state.activeIndex = -1;
      state.networkDetailIndex = null;
      renderApp();
      if (videoEl) {
        updateTimelineHighlight(state, appRoot, videoEl, scrollState);
      }
      return;
    }

    if (role === "subtype-filter") {
      const subtype = btn.dataset.subtype as import("@jittle-lamp/shared").NetworkSubtype | "all" | undefined;
      if (!subtype) return;
      state.networkSubtypeFilter = subtype;
      state.networkDetailIndex = null;
      renderApp();
      if (videoEl) {
        updateTimelineHighlight(state, appRoot, videoEl, scrollState);
      }
      return;
    }

    if (role === "network-search") {
      return;
    }

    if (role === "viewer-focus-btn") {
      state.autoFollow = true;
      btn.hidden = true;
      return;
    }

    if (role === "ctx-merge") {
      hideContextMenu();
      const selectedIds = getSelectedMergeableActionIds();
      if (selectedIds.length < 2) {
        setFeedback("Select 2 or more consecutive actions to merge.", "neutral");
        renderFeedback(state, appRoot);
        return;
      }
      openMergeDialog(selectedIds);
      return;
    }

    if (role === "ctx-unmerge") {
      const targetId = ctxTargetId;
      hideContextMenu();
      if (!targetId) return;
      state.mergeGroups = state.mergeGroups.filter((g) => g.id !== targetId);
      state.archive = getReviewedArchive();
      state.selectedActionIds = new Set();
      state.anchorActionId = null;
      renderApp();
      if (videoEl) {
        updateTimelineHighlight(state, appRoot, videoEl, scrollState);
      }
      return;
    }

    if (role === "timeline-item") {
      const section = btn.dataset.section as TimelineSection | undefined;
      const itemId = btn.dataset.itemId;
      if (section === "actions") {
        if (event.metaKey || event.ctrlKey) {
          if (!itemId) return;
          const selection = toggleActionSelection(
            { selectedActionIds: state.selectedActionIds, anchorActionId: state.anchorActionId },
            itemId
          );
          state.selectedActionIds = selection.selectedActionIds;
          state.anchorActionId = selection.anchorActionId;
          btn.dataset.selected = state.selectedActionIds.has(itemId) ? "true" : "false";
          return;
        }

        if (event.shiftKey && state.anchorActionId && itemId && state.archive) {
          const selection = selectActionRange(
            state.archive,
            state.mergeGroups,
            { selectedActionIds: state.selectedActionIds, anchorActionId: state.anchorActionId },
            itemId
          );
          if (selection.selectedActionIds.size > 0) {
            state.selectedActionIds = selection.selectedActionIds;
            appRoot.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item'][data-section='actions']").forEach((b) => {
              const bid = b.dataset.itemId;
              if (bid) b.dataset.selected = state.selectedActionIds.has(bid) ? "true" : "false";
            });
          }
          return;
        }

        if (itemId) {
          const selection = selectSingleAction(itemId);
          state.selectedActionIds = selection.selectedActionIds;
          state.anchorActionId = selection.anchorActionId;
          appRoot.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item'][data-section='actions']").forEach((b) => {
            b.dataset.selected = b.dataset.itemId === itemId ? "true" : "false";
          });
        }

        if (btn.dataset.offsetMs && videoEl) {
          const offsetMs = Number(btn.dataset.offsetMs);
          videoEl.currentTime = offsetMs / 1000;
        }
        if (videoEl) {
          updateTimelineHighlight(state, appRoot, videoEl, scrollState);
        }
        return;
      }

      const idx = Number(btn.dataset.index);
      const item = state.timeline.find((t) => t.id === itemId);
      if (!item) return;

      if (videoEl) videoEl.currentTime = item.offsetMs / 1000;
      state.activeIndex = idx;

      if (section === "network") {
        const networkIdx = state.timeline.indexOf(item);
        const isAlreadyOpen = state.networkDetailIndex === networkIdx;
        state.networkDetailIndex = isAlreadyOpen ? null : networkIdx;
      }

      renderApp();
      if (videoEl) {
        updateTimelineHighlight(state, appRoot, videoEl, scrollState);
      }
      return;
    }

    if (role === "copy-value") {
      const value = btn.dataset.copyValue ?? "";
      const label = btn.dataset.copyLabel ?? "value";
      void copyValue(value, label);
    }
  });

  appRoot.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const btn = target.closest<HTMLButtonElement>("[data-role='timeline-item'][data-section='actions']");
    if (!btn) return;

    event.preventDefault();

    const itemId = btn.dataset.itemId;
    const isMerged = btn.dataset.merged === "true";
    if (!itemId) return;

    if (!state.selectedActionIds.has(itemId)) {
      const selection = selectSingleAction(itemId);
      state.selectedActionIds = selection.selectedActionIds;
      state.anchorActionId = selection.anchorActionId;
      appRoot.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item'][data-section='actions']").forEach((b) => {
        b.dataset.selected = b.dataset.itemId === itemId ? "true" : "false";
      });
    }

    showContextMenu(event.clientX, event.clientY, itemId, isMerged);
  });

  appRoot.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest("[data-role='viewer-section-body']")) return;
      if (scrollState.isAutoScrolling) return;

      if (state.autoFollow) {
        state.autoFollow = false;
        const focusBtn = appRoot.querySelector<HTMLElement>("[data-role='viewer-focus-btn']");
        if (focusBtn) focusBtn.hidden = false;
      }
    },
    true
  );

  appRoot.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.role === "network-search") {
      state.networkSearchQuery = target.value;
      state.networkDetailIndex = null;
      renderApp();
      if (videoEl) {
        updateTimelineHighlight(state, appRoot, videoEl, scrollState);
      }
      return;
    }

    if (target.dataset.role === "viewer-merge-dialog-input") {
      state.mergeDialogValue = target.value;
      state.mergeDialogError = null;
    }
  });

  appRoot.addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.dataset.role !== "viewer-merge-dialog-input") return;

    if (event.key === "Enter") {
      event.preventDefault();
      submitMergeDialog();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMergeDialog();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.mergeDialogOpen) {
      closeMergeDialog();
    }
  });

}

function bindDropZoneEvents(): void {
  const dropArea = appRoot.querySelector<HTMLElement>("#drop-area");
  const fileInput = appRoot.querySelector<HTMLInputElement>("#file-input");

  if (!dropArea || !fileInput || state.phase === "loading") {
    return;
  }

  dropArea.addEventListener(
    "dragover",
    (event) => {
      event.preventDefault();
      dropArea.dataset.dragover = "true";
    },
    { once: true }
  );
  dropArea.addEventListener(
    "dragleave",
    () => {
      dropArea.dataset.dragover = "false";
      bindDropZoneEvents();
    },
    { once: true }
  );
  dropArea.addEventListener(
    "drop",
    (event) => {
      event.preventDefault();
      dropArea.dataset.dragover = "false";
      const file = event.dataTransfer?.files[0];
      if (file) void handleFile(file);
      bindDropZoneEvents();
    },
    { once: true }
  );
  fileInput.addEventListener(
    "change",
    () => {
      const file = fileInput.files?.[0];
      if (file) void handleFile(file);
      bindDropZoneEvents();
    },
    { once: true }
  );
}

async function copyValue(value: string, label: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "absolute";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setFeedback(`Copied ${label}.`, "success");
  } catch {
    setFeedback(`Failed to copy ${label}.`, "error");
  }
  renderFeedback(state, appRoot);
}

function hideContextMenu(): void {
  const menu = appRoot.querySelector<HTMLElement>("[data-role='viewer-context-menu']");
  if (menu) menu.hidden = true;
  ctxTargetId = null;
}

function openMergeDialog(selectedActionIds: string[]): void {
  openMergeDialogState(state, selectedActionIds);
  renderApp();
  if (videoEl) {
    updateTimelineHighlight(state, appRoot, videoEl, scrollState);
  }
}

function closeMergeDialog(): void {
  closeMergeDialogState(state);
  renderApp();
  if (videoEl) {
    updateTimelineHighlight(state, appRoot, videoEl, scrollState);
  }
}

function submitMergeDialog(): void {
  const validation = validateMergeDialog(state);
  if (!validation.ok) {
    state.mergeDialogError = validation.error;
    renderApp();
    if (videoEl) {
      updateTimelineHighlight(state, appRoot, videoEl, scrollState);
    }
    return;
  }

  const newGroup = createMergeGroup({
    id: `merge-${Date.now()}`,
    createdAt: new Date().toISOString(),
    label: validation.label,
    selectedActionIds: validation.selectedActionIds
  });
  state.mergeGroups = [...state.mergeGroups, newGroup];
  state.archive = getReviewedArchive();
  state.selectedActionIds = new Set();
  state.anchorActionId = null;
  closeMergeDialogState(state);
  renderApp();
  if (videoEl) {
    updateTimelineHighlight(state, appRoot, videoEl, scrollState);
  }
}

function showContextMenu(x: number, y: number, targetId: string, isMerged: boolean): void {
  const menu = appRoot.querySelector<HTMLElement>("[data-role='viewer-context-menu']");
  if (!menu) return;

  ctxTargetId = targetId;

  const mergeBtn = menu.querySelector<HTMLElement>("[data-role='ctx-merge']");
  const unmergeBtn = menu.querySelector<HTMLElement>("[data-role='ctx-unmerge']");

  if (mergeBtn) mergeBtn.hidden = isMerged;
  if (unmergeBtn) unmergeBtn.hidden = !isMerged;

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.hidden = false;
}

function getSelectedMergeableActionIds(): string[] {
  if (!state.archive) {
    return [];
  }

  return getContiguousMergeableSelection(state.archive, state.mergeGroups, state.selectedActionIds);
}

function getReviewedArchive(): SessionArchive | null {
  if (!state.archive) return null;
  return buildReviewedArchive({
    archive: state.archive,
    mergeGroups: state.mergeGroups
  });
}

function downloadUpdatedZip(): void {
  if (!state.archive || !state.recordingBytes) {
    setFeedback("Nothing loaded to export.", "error");
    renderFeedback(state, appRoot);
    return;
  }

  const zipBytes = buildReviewedSessionZip({
    archive: state.archive,
    mergeGroups: state.mergeGroups,
    recordingBytes: state.recordingBytes
  });

  const blob = new Blob([Uint8Array.from(zipBytes).buffer], { type: "application/zip" });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `${state.archive.sessionId}-reviewed.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);

  const nextArchive = getReviewedArchive();
  if (nextArchive) {
    state.archive = nextArchive;
  }

  setFeedback("Updated ZIP exported.", "success");
  renderFeedback(state, appRoot);
}
