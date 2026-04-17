import type { DesktopCompanionConfigSnapshot, DesktopCompanionRuntimeSnapshot, SessionRecord, ViewerPayload } from "../rpc";
import { buildSectionTimeline, buildTimeline, buildVisibleActionRangeSelection, findActiveIndex, formatOffset, getContiguousMergeableActionIds } from "@jittle-lamp/shared";
import type { ActionMergeGroup, NetworkSubtype, TimelineSection } from "@jittle-lamp/shared";
import { createDesktopBridge } from "./desktop-bridge";
import { filterSessions, formatRuntimeLabel, formatSourceLabel, isDatePreset, renderInlineTagAutocompleteHtml, renderSessionsHtml, renderTagAutocompleteHtml, renderTagFilterHtml, type DatePreset } from "./catalog-view";
import { escapeHtml, formatBytes, formatErrorMessage, formatRelativeTime, queryRequiredElement } from "./utils";
import { collectViewerVideoDiagnostics, createViewerVideoState, loadViewerVideoSource, recordViewerVideoEvent, resetViewerVideoDiagnostics } from "./viewer-video";
import { applyViewerPayload, createViewerState, resetViewerState, type ViewerState } from "./viewer-state";
import { canEditViewerNotes, getViewerReadOnlyNotice, getViewerSourceLabel, shouldClearViewerTempSession, shouldPersistViewerReviewState } from "./viewer-source";

type FeedbackTone = "neutral" | "success" | "error";

type ViewState = {
  bridgeError: string | null;
  config: DesktopCompanionConfigSnapshot | null;
  runtime: DesktopCompanionRuntimeSnapshot | null;
  sessions: SessionRecord[];
  allTags: string[];
  dateFilter: DatePreset;
  tagFilter: string | null;
  drawerOpen: boolean;
  editingTagSessionId: string | null;
  tagInputValue: string;
  pendingDeleteId: string | null;
  draftOutputDir: string;
  feedback: { text: string; tone: FeedbackTone };
  isChoosingFolder: boolean;
  isLoading: boolean;
  isSaving: boolean;
};

const runtimePollIntervalMs = 2_000;
const desktopBridge = createDesktopBridge();
let pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null;
const viewerVideoState = createViewerVideoState();
let isAutoScrolling = false;

const viewerState: ViewerState = createViewerState();

const state: ViewState = {
  bridgeError: null,
  config: null,
  runtime: null,
  sessions: [],
  allTags: [],
  dateFilter: "all",
  tagFilter: null,
  drawerOpen: false,
  editingTagSessionId: null,
  tagInputValue: "",
  pendingDeleteId: null,
  draftOutputDir: "",
  feedback: { text: "Loading desktop companion status…", tone: "neutral" },
  isChoosingFolder: false,
  isLoading: true,
  isSaving: false
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Desktop main view root element was not found.");
}

const appRoot = app;

appRoot.innerHTML = `
  <div class="app-shell">
    <div class="top-bar">
        <span class="app-name">Jittle Lamp</span>
      <div class="top-bar-right">
        <span class="status-pill" data-role="runtime-pill" data-status="starting">Starting</span>
        <span class="output-path" data-role="output-path">—</span>
        <button class="open-local-btn" type="button" data-role="open-local-btn" aria-label="Open local session">Open Local…</button>
        <button class="import-zip-btn" type="button" data-role="import-zip-btn" aria-label="Import ZIP">Import ZIP…</button>
        <button class="gear-btn" type="button" data-role="gear-btn" aria-label="Settings">⚙</button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="date-toggles">
        <button class="date-toggle" type="button" data-role="date-toggle" data-preset="today">Today</button>
        <button class="date-toggle" type="button" data-role="date-toggle" data-preset="week">Week</button>
        <button class="date-toggle" type="button" data-role="date-toggle" data-preset="month">Month</button>
        <button class="date-toggle" type="button" data-role="date-toggle" data-preset="all" data-active="true">All</button>
      </div>
      <div class="tag-filter" data-role="tag-filter-wrapper"></div>
      <span class="results-count" data-role="results-count">0 sessions</span>
    </div>

    <div class="feedback-banner" data-role="feedback" data-tone="neutral">Loading desktop companion status…</div>

    <div class="sessions-scroll" data-role="sessions-scroll"></div>

    <div class="drawer-overlay" data-role="drawer-overlay" data-open="false"></div>

    <div class="settings-drawer" data-role="settings-drawer" data-open="false">
      <div class="drawer-header">
        <span class="drawer-title">Settings</span>
        <button class="drawer-close" type="button" data-role="drawer-close" aria-label="Close">✕</button>
      </div>
      <div class="drawer-content">
        <div class="drawer-section">
          <span class="drawer-section-label">Output folder</span>
          <div class="drawer-path-display" data-role="current-output-dir">—</div>
          <p class="drawer-effective-summary" data-role="effective-summary">Reading the current output folder…</p>
          <div class="env-override-warning" data-role="env-override-warning" hidden>
            JITTLE_LAMP_OUTPUT_DIR is active and overrides the saved setting.
          </div>
          <input class="path-input" type="text" data-role="output-dir-field" readonly />
          <div class="drawer-action-row">
            <button class="button primary sm" type="button" data-role="choose-button">Choose folder…</button>
            <button class="button secondary sm" type="button" data-role="save-button">Save route</button>
          </div>
          <div class="drawer-action-row">
            <button class="button ghost sm" type="button" data-role="open-output-button">Open folder</button>
            <button class="button ghost sm" type="button" data-role="open-config-button">Open config</button>
          </div>
        </div>

        <div class="drawer-section">
          <span class="drawer-section-label">Route details</span>
          <div class="drawer-detail-grid">
            <div class="drawer-detail-item">
              <span class="drawer-detail-label">Source</span>
              <span class="drawer-detail-value" data-role="detail-source">—</span>
            </div>
            <div class="drawer-detail-item">
              <span class="drawer-detail-label">Saved file</span>
              <span class="drawer-detail-value" data-role="detail-saved-output">—</span>
            </div>
            <div class="drawer-detail-item">
              <span class="drawer-detail-label">Default folder</span>
              <span class="drawer-detail-value" data-role="detail-default-output">—</span>
            </div>
            <div class="drawer-detail-item">
              <span class="drawer-detail-label">Config file</span>
              <span class="drawer-detail-value" data-role="detail-config-path">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="viewer-overlay" data-role="viewer-overlay" data-open="false">
      <div class="viewer-modal">
        <div class="viewer-header">
          <div class="viewer-header-left">
            <span class="viewer-title" data-role="viewer-title"></span>
            <span class="viewer-source-badge" data-role="viewer-source-badge"></span>
          </div>
          <button class="viewer-close" type="button" data-role="viewer-close" aria-label="Close viewer">✕</button>
        </div>
        <div class="viewer-body">
            <div class="viewer-left">
              <div class="viewer-video-wrap">
                <video class="viewer-video" data-role="viewer-video" controls></video>
              </div>
              <div class="viewer-notes-section" data-role="viewer-notes-section">
              <span class="viewer-notes-label">Session notes</span>
              <div class="viewer-zip-notice" data-role="viewer-zip-notice" hidden>
                Notes are read-only for ZIP imports and are not saved.
              </div>
              <textarea class="viewer-notes-textarea" data-role="viewer-notes-textarea" placeholder="Add notes…"></textarea>
              <div class="viewer-notes-actions">
                <button class="button sm primary" type="button" data-role="viewer-notes-save">Save notes</button>
              </div>
            </div>
          </div>
          <div class="viewer-right">
            <div class="viewer-section-tabs" data-role="viewer-section-tabs">
              <button class="section-tab" type="button" data-role="section-tab" data-section="actions" data-active="true">Actions</button>
              <button class="section-tab" type="button" data-role="section-tab" data-section="console">Console</button>
              <button class="section-tab" type="button" data-role="section-tab" data-section="network">Network</button>
            </div>
            <div class="viewer-network-filter" data-role="viewer-network-filter" hidden>
              <button class="subtype-filter" type="button" data-role="subtype-filter" data-subtype="all" data-active="true">All</button>
              <button class="subtype-filter subtype-emphasis" type="button" data-role="subtype-filter" data-subtype="xhr">XHR</button>
              <button class="subtype-filter subtype-emphasis" type="button" data-role="subtype-filter" data-subtype="fetch">Fetch</button>
              <button class="subtype-filter" type="button" data-role="subtype-filter" data-subtype="document">Doc</button>
              <button class="subtype-filter" type="button" data-role="subtype-filter" data-subtype="script">Script</button>
              <button class="subtype-filter" type="button" data-role="subtype-filter" data-subtype="image">Img</button>
              <button class="subtype-filter" type="button" data-role="subtype-filter" data-subtype="font">Font</button>
              <button class="subtype-filter" type="button" data-role="subtype-filter" data-subtype="media">Media</button>
              <button class="subtype-filter" type="button" data-role="subtype-filter" data-subtype="websocket">WS</button>
              <button class="subtype-filter" type="button" data-role="subtype-filter" data-subtype="other">Other</button>
              <input class="viewer-network-search" type="text" data-role="network-search" placeholder="Search URL, headers, response, or /regex/" />
            </div>
            <div class="viewer-section-body" data-role="viewer-section-body">
              <div class="viewer-timeline" data-role="viewer-timeline"></div>
              <button class="viewer-focus-btn" type="button" data-role="viewer-focus-btn" hidden>↓ Focus</button>
            </div>
            <div class="viewer-network-detail" data-role="viewer-network-detail" hidden>
              <div class="viewer-network-detail-header">
                <span class="viewer-panel-label">Network request</span>
                <button class="viewer-detail-close" type="button" data-role="viewer-detail-close" aria-label="Close detail">✕</button>
              </div>
              <div class="viewer-network-detail-body" data-role="viewer-network-detail-body"></div>
            </div>
          </div>
        </div>
        <div class="viewer-context-menu" data-role="viewer-context-menu" hidden>
          <button class="context-menu-item" type="button" data-role="ctx-merge">Merge Actions…</button>
          <button class="context-menu-item" type="button" data-role="ctx-unmerge">Un-merge</button>
        </div>
        <div class="viewer-merge-dialog-backdrop" data-role="viewer-merge-dialog-backdrop" hidden>
          <div class="viewer-merge-dialog" role="dialog" aria-modal="true" aria-labelledby="viewer-merge-dialog-title">
            <div class="viewer-merge-dialog-header">
              <span class="viewer-panel-label" id="viewer-merge-dialog-title">Merge actions</span>
            </div>
            <div class="viewer-merge-dialog-body">
              <label class="viewer-merge-dialog-label" for="viewer-merge-dialog-input">Merged action name</label>
              <input class="viewer-merge-dialog-input" id="viewer-merge-dialog-input" data-role="viewer-merge-dialog-input" type="text" maxlength="160" placeholder="Merged actions" />
              <div class="viewer-merge-dialog-error" data-role="viewer-merge-dialog-error" hidden></div>
            </div>
            <div class="viewer-merge-dialog-actions">
              <button class="button sm" type="button" data-role="viewer-merge-dialog-cancel">Cancel</button>
              <button class="button sm primary" type="button" data-role="viewer-merge-dialog-confirm">Merge</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const runtimePill = queryRequiredElement<HTMLSpanElement>(appRoot, "[data-role='runtime-pill']");
const outputPath = queryRequiredElement<HTMLSpanElement>(appRoot, "[data-role='output-path']");
const gearBtn = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='gear-btn']");
const importZipBtn = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='import-zip-btn']");
const openLocalBtn = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='open-local-btn']");
const tagFilterWrapper = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='tag-filter-wrapper']");
const resultsCount = queryRequiredElement<HTMLSpanElement>(appRoot, "[data-role='results-count']");
const feedback = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='feedback']");
const sessionsScroll = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='sessions-scroll']");
const drawerOverlay = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='drawer-overlay']");
const settingsDrawer = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='settings-drawer']");
const drawerClose = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='drawer-close']");
const currentOutputDir = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='current-output-dir']");
const effectiveSummary = queryRequiredElement<HTMLParagraphElement>(appRoot, "[data-role='effective-summary']");
const envOverrideWarning = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='env-override-warning']");
const outputDirField = queryRequiredElement<HTMLInputElement>(appRoot, "[data-role='output-dir-field']");
const chooseButton = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='choose-button']");
const saveButton = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='save-button']");
const openOutputButton = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='open-output-button']");
const openConfigButton = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='open-config-button']");
const detailSource = queryRequiredElement<HTMLElement>(appRoot, "[data-role='detail-source']");
const detailSavedOutput = queryRequiredElement<HTMLElement>(appRoot, "[data-role='detail-saved-output']");
const detailDefaultOutput = queryRequiredElement<HTMLElement>(appRoot, "[data-role='detail-default-output']");
const detailConfigPath = queryRequiredElement<HTMLElement>(appRoot, "[data-role='detail-config-path']");

const viewerOverlay = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-overlay']");
const viewerClose = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='viewer-close']");
const viewerTitle = queryRequiredElement<HTMLSpanElement>(appRoot, "[data-role='viewer-title']");
const viewerSourceBadge = queryRequiredElement<HTMLSpanElement>(appRoot, "[data-role='viewer-source-badge']");
const viewerVideo = queryRequiredElement<HTMLVideoElement>(appRoot, "[data-role='viewer-video']");
const viewerTimeline = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-timeline']");
const viewerZipNotice = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-zip-notice']");
const viewerNotesTextarea = queryRequiredElement<HTMLTextAreaElement>(appRoot, "[data-role='viewer-notes-textarea']");
const viewerNotesSave = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='viewer-notes-save']");
const viewerNetworkDetail = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-network-detail']");
const viewerDetailClose = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='viewer-detail-close']");
const viewerNetworkDetailBody = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-network-detail-body']");
const viewerSectionTabs = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-section-tabs']");
const viewerNetworkFilter = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-network-filter']");
const viewerSectionBody = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-section-body']");
const viewerFocusBtn = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='viewer-focus-btn']");
const viewerContextMenu = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-context-menu']");
const ctxMergeBtn = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='ctx-merge']");
const ctxUnmergeBtn = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='ctx-unmerge']");
const viewerNetworkSearch = queryRequiredElement<HTMLInputElement>(appRoot, "[data-role='network-search']");
const viewerMergeDialogBackdrop = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-merge-dialog-backdrop']");
const viewerMergeDialogInput = queryRequiredElement<HTMLInputElement>(appRoot, "[data-role='viewer-merge-dialog-input']");
const viewerMergeDialogError = queryRequiredElement<HTMLDivElement>(appRoot, "[data-role='viewer-merge-dialog-error']");
const viewerMergeDialogCancel = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='viewer-merge-dialog-cancel']");
const viewerMergeDialogConfirm = queryRequiredElement<HTMLButtonElement>(appRoot, "[data-role='viewer-merge-dialog-confirm']");

let contextTargetId: string | null = null;

gearBtn.addEventListener("click", () => {
  openDrawer();
});

importZipBtn.addEventListener("click", () => {
  void handleImportZip();
});

openLocalBtn.addEventListener("click", () => {
  void handleOpenLocalSession();
});

viewerClose.addEventListener("click", () => {
  void closeViewer();
});

viewerOverlay.addEventListener("click", (event) => {
  if (event.target === viewerOverlay) {
    void closeViewer();
  }
});

viewerDetailClose.addEventListener("click", () => {
  viewerState.networkDetailIndex = null;
  renderViewerNetworkDetail();
});

viewerNetworkDetailBody.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;

  const copyTarget = event.target.closest<HTMLElement>("[data-role='copy-value']");
  const copyValue = copyTarget?.dataset.copyValue;

  if (!copyTarget || !copyValue) {
    return;
  }

  void copyViewerValue(copyValue, copyTarget.dataset.copyLabel ?? "value");
});

viewerNotesTextarea.addEventListener("input", () => {
  viewerState.notesValue = viewerNotesTextarea.value;
  viewerState.notesDirty = viewerState.notesValue !== (viewerState.payload?.notes ?? "");
  viewerNotesSave.disabled = !viewerState.notesDirty || viewerState.notesSaving;
});

viewerNotesSave.addEventListener("click", () => {
  void saveViewerNotes();
});

viewerVideo.addEventListener("timeupdate", () => {
  updateTimelineHighlight();
});

viewerNetworkSearch.addEventListener("input", () => {
  viewerState.networkSearchQuery = viewerNetworkSearch.value;
  viewerState.networkDetailIndex = null;
  renderViewerTimeline();
  renderViewerNetworkDetail();
  updateTimelineHighlight();
});

viewerMergeDialogInput.addEventListener("input", () => {
  viewerState.mergeDialogValue = viewerMergeDialogInput.value;
  viewerState.mergeDialogError = null;
  renderViewerMergeDialog();
});

viewerMergeDialogInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitViewerMergeDialog();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeViewerMergeDialog();
  }
});

viewerMergeDialogCancel.addEventListener("click", () => {
  closeViewerMergeDialog();
});

viewerMergeDialogConfirm.addEventListener("click", () => {
  submitViewerMergeDialog();
});

viewerMergeDialogBackdrop.addEventListener("click", (event) => {
  if (event.target === viewerMergeDialogBackdrop) {
    closeViewerMergeDialog();
  }
});

for (const mediaEventName of [
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "canplaythrough",
  "play",
  "playing",
  "waiting",
  "stalled",
  "suspend",
  "abort",
  "emptied",
  "pause",
  "error"
] as const) {
  viewerVideo.addEventListener(mediaEventName, () => {
    recordViewerVideoEvent(viewerVideo, viewerVideoState, mediaEventName);
  });
}

viewerVideo.addEventListener("error", () => {
  const diagnostics = collectViewerVideoDiagnostics(viewerVideo, viewerVideoState, "error-event");

  console.error("[jittle-lamp][viewer-video] playback failed", diagnostics);

  state.feedback = {
    tone: "error",
    text: `Unable to play the evidence video (${diagnostics.error.codeLabel}). Full media diagnostics logged.`
  };
  render();
});

viewerTimeline.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const item = event.target.closest<HTMLButtonElement>("[data-role='timeline-item']");
  if (!item) return;
  const itemId = item.dataset.itemId ?? "";
  const offsetMs = Number(item.dataset.offsetMs);

  if (Number.isFinite(offsetMs)) {
    viewerVideo.currentTime = Math.max(0, offsetMs / 1000);
  }

  if (item.dataset.section === "actions") {
    if (event.metaKey || event.ctrlKey) {
      if (viewerState.selectedActionIds.has(itemId)) {
        viewerState.selectedActionIds.delete(itemId);
      } else {
        viewerState.selectedActionIds.add(itemId);
        viewerState.anchorActionId = itemId;
      }
      renderViewerTimeline();
      updateTimelineHighlight();
      return;
    }

    if (event.shiftKey && viewerState.anchorActionId) {
      const rangeIds = buildVisibleActionRangeSelection(
        viewerState.payload!.archive,
        viewerState.mergeGroups,
        viewerState.anchorActionId,
        itemId
      );
      if (rangeIds.length > 0) {
        viewerState.selectedActionIds = new Set(rangeIds);
        renderViewerTimeline();
        updateTimelineHighlight();
        return;
      }
    }

    viewerState.selectedActionIds = new Set([itemId]);
    viewerState.anchorActionId = itemId;
    renderViewerTimeline();
    updateTimelineHighlight();
    return;
  }

  const fullTimelineIndex = viewerState.timeline.findIndex((timelineItem) => timelineItem.id === itemId);
  if (fullTimelineIndex === -1) return;
  const timelineItem = viewerState.timeline[fullTimelineIndex];
  if (!timelineItem) return;
  viewerState.networkDetailIndex =
    timelineItem.kind === "network" && viewerState.networkDetailIndex !== fullTimelineIndex ? fullTimelineIndex : null;
  renderViewerNetworkDetail();
});

viewerTimeline.addEventListener("contextmenu", (event) => {
  if (!(event.target instanceof Element)) return;
  const item = event.target.closest<HTMLButtonElement>("[data-role='timeline-item']");
  if (!item || item.dataset.section !== "actions") return;
  event.preventDefault();

  const itemId = item.dataset.itemId ?? "";
  contextTargetId = itemId;
  if (!viewerState.selectedActionIds.has(itemId)) {
    viewerState.selectedActionIds = new Set([itemId]);
    viewerState.anchorActionId = itemId;
    renderViewerTimeline();
  }

  const isMerged = item.dataset.merged === "true";
  ctxMergeBtn.hidden = isMerged || getSelectedActionEntryIds().length < 2;
  ctxUnmergeBtn.hidden = !isMerged;

  viewerContextMenu.hidden = false;
  viewerContextMenu.style.left = `${event.clientX}px`;
  viewerContextMenu.style.top = `${event.clientY}px`;
});

viewerSectionTabs.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const tab = event.target.closest<HTMLButtonElement>("[data-role='section-tab']");
  if (!tab) return;
  const section = tab.dataset.section as TimelineSection | undefined;
  if (!section) return;
  viewerState.activeSection = section;
  viewerState.networkDetailIndex = null;
  renderViewerSectionTabs();
  renderViewerNetworkFilter();
  renderViewerTimeline();
  renderViewerNetworkDetail();
  updateTimelineHighlight();
});

viewerNetworkFilter.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const btn = event.target.closest<HTMLButtonElement>("[data-role='subtype-filter']");
  if (!btn) return;
  const subtype = btn.dataset.subtype as NetworkSubtype | "all" | undefined;
  if (!subtype) return;
  viewerState.networkSubtypeFilter = subtype;
  viewerState.networkDetailIndex = null;
  renderViewerNetworkFilter();
  renderViewerTimeline();
  renderViewerNetworkDetail();
  updateTimelineHighlight();
});

viewerSectionBody.addEventListener("scroll", () => {
  if (isAutoScrolling) return;
  if (viewerState.autoFollow) {
    viewerState.autoFollow = false;
    viewerFocusBtn.hidden = false;
  }
});

viewerFocusBtn.addEventListener("click", () => {
  viewerState.autoFollow = true;
  viewerFocusBtn.hidden = true;
  updateTimelineHighlight();
});

ctxMergeBtn.addEventListener("click", () => {
  hideContextMenu();
  const selectedActionIds = getSelectedActionEntryIds();
  if (selectedActionIds.length < 2) {
    state.feedback = { tone: "error", text: "Select at least two actions before merging." };
    render();
    return;
  }

  openViewerMergeDialog(selectedActionIds);
});

ctxUnmergeBtn.addEventListener("click", () => {
  const targetId = contextTargetId;
  hideContextMenu();
  if (!targetId) return;
  viewerState.mergeGroups = viewerState.mergeGroups.filter((g) => g.id !== targetId);
  viewerState.selectedActionIds = new Set();
  void persistViewerReviewState("Merge removed.");
});

document.addEventListener("click", (event) => {
  if (!viewerContextMenu.hidden && event.target instanceof Element && !viewerContextMenu.contains(event.target)) {
    hideContextMenu();
  }
});

drawerClose.addEventListener("click", () => {
  closeDrawer();
});

drawerOverlay.addEventListener("click", () => {
  closeDrawer();
});

chooseButton.addEventListener("click", () => {
  void chooseFolder();
});

saveButton.addEventListener("click", () => {
  void saveFolder();
});

openOutputButton.addEventListener("click", () => {
  void openCurrentOutputFolder();
});

openConfigButton.addEventListener("click", () => {
  if (!desktopBridge || !state.config) return;
  void desktopBridge.rpc.request.openPath({ path: state.config.configFilePath });
});

appRoot.querySelectorAll<HTMLButtonElement>("[data-role='date-toggle']").forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = btn.dataset.preset;
    if (!isDatePreset(preset)) return;
    state.dateFilter = preset;
    render();
  });
});

tagFilterWrapper.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const removeBtn = event.target.closest<HTMLButtonElement>("[data-role='tag-filter-remove']");
  if (removeBtn) {
    state.tagFilter = null;
    render();
  }
});

tagFilterWrapper.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.dataset.role !== "tag-filter-input") return;
  updateTagFilterAutocomplete(event.target.value);
});

tagFilterWrapper.addEventListener("keydown", (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.dataset.role !== "tag-filter-input") return;
  if (event.key === "Escape") {
    event.target.value = "";
    updateTagFilterAutocomplete("");
  }
});

sessionsScroll.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;

  const viewBtn = event.target.closest<HTMLButtonElement>("[data-role='session-view-btn']");
  if (viewBtn) {
    const sessionId = viewBtn.dataset.sessionId;
    if (!sessionId || !desktopBridge) return;
    void handleViewSession(sessionId);
    return;
  }

  const openBtn = event.target.closest<HTMLButtonElement>("[data-role='session-open-btn']");
  if (openBtn) {
    const sessionId = openBtn.dataset.sessionId;
    if (!sessionId || !desktopBridge) return;
    const session = state.sessions.find((s) => s.sessionId === sessionId);
    if (!session) return;
    void desktopBridge.rpc.request.openPath({ path: session.sessionFolder });
    return;
  }

  const zipBtn = event.target.closest<HTMLButtonElement>("[data-role='session-zip-btn']");
  if (zipBtn) {
    const sessionId = zipBtn.dataset.sessionId;
    if (!sessionId || !desktopBridge) return;
    void handleExportSessionZip(sessionId);
    return;
  }

  const deleteBtn = event.target.closest<HTMLButtonElement>("[data-role='session-delete-btn']");
  if (deleteBtn) {
    const sessionId = deleteBtn.dataset.sessionId;
    if (!sessionId) return;
    handleDeleteClick(sessionId);
    return;
  }

  const tagX = event.target.closest<HTMLButtonElement>("[data-role='tag-chip-x']");
  if (tagX) {
    const sessionId = tagX.dataset.sessionId;
    const tag = tagX.dataset.tag;
    if (!sessionId || !tag) return;
    void removeTagFromSession(sessionId, tag);
    return;
  }

  const addBtn = event.target.closest<HTMLButtonElement>("[data-role='tag-add-btn']");
  if (addBtn) {
    const sessionId = addBtn.dataset.sessionId;
    if (!sessionId) return;
    state.editingTagSessionId = sessionId;
    state.tagInputValue = "";
    render();
    focusTagInput();
    return;
  }

  const tagOption = event.target.closest<HTMLButtonElement>("[data-role='tag-inline-option']");
  if (tagOption) {
    const sessionId = tagOption.dataset.sessionId;
    const tag = tagOption.dataset.tag;
    if (!sessionId || !tag) return;
    state.tagInputValue = tag;
    void addTagToSession(sessionId, tag);
    return;
  }
});

sessionsScroll.addEventListener("keydown", (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.dataset.role !== "tag-input-inline") return;

  const sessionId = event.target.dataset.sessionId;
  if (!sessionId) return;

  if (event.key === "Enter") {
    const value = event.target.value.trim();
    if (value) {
      state.tagInputValue = value;
      void addTagToSession(sessionId, value);
    }
  } else if (event.key === "Escape") {
    state.editingTagSessionId = null;
    state.tagInputValue = "";
    render();
  }
});

sessionsScroll.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.dataset.role !== "tag-input-inline") return;
  state.tagInputValue = event.target.value;
  updateInlineTagAutocomplete(event.target.dataset.sessionId ?? "", event.target.value);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (viewerState.mergeDialogOpen) {
      closeViewerMergeDialog();
    } else if (viewerState.open) {
      void closeViewer();
    } else if (state.drawerOpen) {
      closeDrawer();
    } else if (state.editingTagSessionId !== null) {
      state.editingTagSessionId = null;
      state.tagInputValue = "";
      render();
    }

    return;
  }

  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "q") {
    event.preventDefault();

    if (desktopBridge) {
      void desktopBridge.rpc.request.exitApp(undefined);
    }
  }
});

void loadInitialData();

function render(): void {
  const config = state.config;
  const runtime = state.runtime;
  const hasBridgeError = state.bridgeError !== null;
  const isEnvOverrideActive = config?.envOverrideActive ?? false;
  const draftOutputDir = config ? state.draftOutputDir : "";
  const isDirty = Boolean(config && draftOutputDir !== config.outputDir);

  runtimePill.textContent = formatRuntimeLabel(runtime?.status);
  runtimePill.dataset.status = runtime?.status ?? "starting";

  outputPath.textContent = runtime?.outputDir ?? config?.outputDir ?? "—";

  feedback.textContent = state.feedback.text;
  feedback.dataset.tone = state.feedback.tone;

  currentOutputDir.textContent = config?.outputDir ?? runtime?.outputDir ?? "—";
  effectiveSummary.textContent = config
    ? isEnvOverrideActive
      ? "Environment override is active — the desktop route is locked until that variable is removed."
      : "The extension will use this folder whenever the local companion is online."
    : "Reading the current output folder…";

  envOverrideWarning.hidden = !isEnvOverrideActive;

  outputDirField.value = draftOutputDir;
  outputDirField.disabled = true;

  detailSource.textContent = config ? formatSourceLabel(config.source) : "—";
  detailSavedOutput.textContent = config?.savedOutputDir ?? "No saved override";
  detailDefaultOutput.textContent = config?.defaultOutputDir ?? "—";
  detailConfigPath.textContent = config?.configFilePath ?? "—";

  chooseButton.disabled = hasBridgeError || state.isLoading || state.isChoosingFolder || state.isSaving || isEnvOverrideActive;
  chooseButton.textContent = state.isChoosingFolder ? "Choosing…" : "Choose folder…";

  saveButton.disabled = hasBridgeError || state.isLoading || state.isSaving || !isDirty || isEnvOverrideActive;
  saveButton.textContent = state.isSaving ? "Saving…" : "Save route";

  openOutputButton.disabled = hasBridgeError || state.isLoading || !config;
  openConfigButton.disabled = hasBridgeError || state.isLoading || !config;

  settingsDrawer.dataset.open = state.drawerOpen ? "true" : "false";
  drawerOverlay.dataset.open = state.drawerOpen ? "true" : "false";

  appRoot.querySelectorAll<HTMLButtonElement>("[data-role='date-toggle']").forEach((btn) => {
    btn.dataset.active = btn.dataset.preset === state.dateFilter ? "true" : "false";
  });

  const filtered = getFilteredSessions();
  resultsCount.textContent = `${filtered.length} session${filtered.length === 1 ? "" : "s"}`;

  renderTagFilterWrapper();
  renderSessions(filtered);

  if (state.editingTagSessionId !== null) {
    focusTagInput();
  }
}

function renderTagFilterWrapper(): void {
  const existingInput = tagFilterWrapper.querySelector<HTMLInputElement>("[data-role='tag-filter-input']");
  if (state.tagFilter === null && existingInput) {
    return;
  }

  tagFilterWrapper.innerHTML = renderTagFilterHtml(state.tagFilter, escapeHtml);
}

function updateTagFilterAutocomplete(value: string): void {
  const autocomplete = tagFilterWrapper.querySelector<HTMLDivElement>("[data-role='tag-filter-autocomplete']");
  if (!autocomplete) return;

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    autocomplete.hidden = true;
    autocomplete.innerHTML = "";
    return;
  }

  const matches = state.allTags.filter((t) => t.toLowerCase().includes(trimmed));
  if (matches.length === 0) {
    autocomplete.hidden = true;
    autocomplete.innerHTML = "";
    return;
  }

  autocomplete.hidden = false;
  autocomplete.innerHTML = renderTagAutocompleteHtml(matches, escapeHtml);

  autocomplete.querySelectorAll<HTMLButtonElement>("[data-role='tag-filter-option']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tag;
      if (!tag) return;
      state.tagFilter = tag;
      render();
    });
  });
}

function renderSessions(filtered: SessionRecord[]): void {
  sessionsScroll.innerHTML = renderSessionsHtml({
    sessions: filtered,
    pendingDeleteId: state.pendingDeleteId,
    editingTagSessionId: state.editingTagSessionId,
    tagInputValue: state.tagInputValue,
    escapeHtml,
    formatRelativeTime,
    formatBytes
  });

  if (isEditing()) {
    const sessionId = state.editingTagSessionId;
    if (sessionId && state.tagInputValue) {
      updateInlineTagAutocomplete(sessionId, state.tagInputValue);
    }
  }
}

function isEditing(): boolean {
  return state.editingTagSessionId !== null;
}

function focusTagInput(): void {
  const input = sessionsScroll.querySelector<HTMLInputElement>("[data-role='tag-input-inline']");
  if (!input) return;
  input.focus();
  const len = input.value.length;
  input.setSelectionRange(len, len);
}

function updateInlineTagAutocomplete(sessionId: string, value: string): void {
  const autocomplete = sessionsScroll.querySelector<HTMLDivElement>(
    `[data-role='tag-inline-autocomplete'][data-session-id='${CSS.escape(sessionId)}']`
  );
  if (!autocomplete) return;

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    autocomplete.hidden = true;
    autocomplete.innerHTML = "";
    return;
  }

  const session = state.sessions.find((s) => s.sessionId === sessionId);
  const existingTags = session?.tags ?? [];
  const matches = state.allTags.filter((t) => !existingTags.includes(t) && t.toLowerCase().includes(trimmed));

  if (matches.length === 0) {
    autocomplete.hidden = true;
    autocomplete.innerHTML = "";
    return;
  }

  autocomplete.hidden = false;
  autocomplete.innerHTML = renderInlineTagAutocompleteHtml({ sessionId, tags: matches, escapeHtml });
}

function getFilteredSessions(): SessionRecord[] {
  return filterSessions({
    sessions: state.sessions,
    tagFilter: state.tagFilter,
    dateFilter: state.dateFilter
  });
}

function openDrawer(): void {
  state.drawerOpen = true;
  render();
}

function closeDrawer(): void {
  state.drawerOpen = false;
  render();
}

async function loadInitialData(): Promise<void> {
  if (!desktopBridge) {
    state.bridgeError = "Electrobun view RPC did not initialize in this renderer.";
    state.feedback = { tone: "error", text: "Desktop runtime unavailable." };
    state.isLoading = false;
    render();
    return;
  }

  try {
    const [config, runtime, sessions, allTags] = await Promise.all([
      desktopBridge.rpc.request.getCompanionConfig(undefined),
      desktopBridge.rpc.request.getCompanionRuntime(undefined),
      desktopBridge.rpc.request.listSessions(undefined).catch((): SessionRecord[] => []),
      desktopBridge.rpc.request.listAllTags(undefined).catch((): string[] => [])
    ]);

    state.config = config;
    state.runtime = runtime;
    state.sessions = sessions;
    state.allTags = allTags;
    state.draftOutputDir = config.outputDir;
    state.feedback = {
      tone: runtime.status === "error" ? "error" : "neutral",
      text:
        runtime.status === "error"
          ? runtime.lastError ?? "The desktop companion failed to start."
          : config.envOverrideActive
            ? "JITTLE_LAMP_OUTPUT_DIR is currently overriding the saved desktop setting."
            : "Choose a folder, save it, and keep this app open while recording."
    };
  } catch (error) {
    state.feedback = {
      tone: "error",
      text: formatErrorMessage(error, "Unable to load desktop companion state.")
    };
  } finally {
    state.isLoading = false;
    render();
    startRuntimePolling();
  }
}

function startRuntimePolling(): void {
  if (!desktopBridge) return;

  setInterval(() => {
    void refreshRuntimeState();
  }, runtimePollIntervalMs);
}

async function refreshRuntimeState(): Promise<void> {
  if (!desktopBridge) return;

  try {
    const [runtime, sessions, allTags] = await Promise.all([
      desktopBridge.rpc.request.getCompanionRuntime(undefined),
      desktopBridge.rpc.request.listSessions(undefined).catch((): SessionRecord[] => state.sessions),
      desktopBridge.rpc.request.listAllTags(undefined).catch((): string[] => state.allTags)
    ]);

    state.runtime = runtime;
    state.sessions = sessions;
    state.allTags = allTags;

    if (runtime.status === "error") {
      state.feedback = {
        tone: "error",
        text: runtime.lastError ?? "The desktop companion runtime is reporting an error."
      };
    } else if (state.feedback.tone !== "success" && !state.isSaving && !state.isChoosingFolder) {
      state.feedback = {
        tone: "neutral",
        text:
          runtime.status === "listening"
            ? "Desktop companion is listening locally. Extension exports should land here without browser download prompts."
            : "Waiting for the desktop companion runtime."
      };
    }

    render();
  } catch (error) {
    state.feedback = {
      tone: "error",
      text: formatErrorMessage(error, "Unable to refresh the companion runtime.")
    };
    render();
  }
}

async function chooseFolder(): Promise<void> {
  if (!desktopBridge || !state.config || state.config.envOverrideActive) return;

  state.isChoosingFolder = true;
  state.feedback = { tone: "neutral", text: "Waiting for a local folder selection…" };
  render();

  try {
    const { selectedPath } = await desktopBridge.rpc.request.chooseOutputDirectory({
      startingFolder: state.draftOutputDir || state.config.outputDir
    });

    if (selectedPath) {
      state.draftOutputDir = selectedPath;
      state.feedback = { tone: "neutral", text: "Folder selected. Save route to switch the running companion." };
    } else {
      state.feedback = { tone: "neutral", text: "Folder selection cancelled." };
    }
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Unable to open the native folder picker.") };
  } finally {
    state.isChoosingFolder = false;
    render();
  }
}

async function saveFolder(): Promise<void> {
  if (!desktopBridge || !state.config || state.config.envOverrideActive) return;

  state.isSaving = true;
  state.feedback = { tone: "neutral", text: "Saving folder route and refreshing the running companion…" };
  render();

  try {
    const nextConfig = await desktopBridge.rpc.request.saveOutputDirectory({ outputDir: state.draftOutputDir });
    const nextRuntime = await desktopBridge.rpc.request.getCompanionRuntime(undefined);

    state.config = nextConfig;
    state.runtime = nextRuntime;
    state.draftOutputDir = nextConfig.outputDir;
    state.feedback = { tone: "success", text: "Saved. New extension exports will use this folder immediately." };
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Unable to save the output folder.") };
  } finally {
    state.isSaving = false;
    render();
  }
}

async function openCurrentOutputFolder(): Promise<void> {
  if (!desktopBridge || !state.config) return;
  await desktopBridge.rpc.request.openPath({ path: state.config.outputDir });
}

function handleDeleteClick(sessionId: string): void {
  if (state.pendingDeleteId === sessionId) {
    if (pendingDeleteTimer !== null) {
      clearTimeout(pendingDeleteTimer);
      pendingDeleteTimer = null;
    }
    state.pendingDeleteId = null;
    void deleteSessionById(sessionId);
  } else {
    if (pendingDeleteTimer !== null) clearTimeout(pendingDeleteTimer);
    state.pendingDeleteId = sessionId;
    render();

    pendingDeleteTimer = setTimeout(() => {
      state.pendingDeleteId = null;
      pendingDeleteTimer = null;
      render();
    }, 3_000);
  }
}

async function deleteSessionById(sessionId: string): Promise<void> {
  if (!desktopBridge) return;

  try {
    await desktopBridge.rpc.request.deleteSession({ sessionId });
    state.sessions = state.sessions.filter((s) => s.sessionId !== sessionId);
    state.feedback = { tone: "success", text: "Session deleted." };
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Failed to delete the session.") };
  }

  render();
}

async function addTagToSession(sessionId: string, tag: string): Promise<void> {
  if (!desktopBridge) return;

  const trimmed = tag.trim();
  if (!trimmed) return;

  try {
    await desktopBridge.rpc.request.addSessionTag({ sessionId, tag: trimmed });
    const [sessions, allTags] = await Promise.all([
      desktopBridge.rpc.request.listSessions(undefined).catch((): SessionRecord[] => state.sessions),
      desktopBridge.rpc.request.listAllTags(undefined).catch((): string[] => state.allTags)
    ]);
    state.sessions = sessions;
    state.allTags = allTags;
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Failed to add tag.") };
  } finally {
    state.editingTagSessionId = null;
    state.tagInputValue = "";
    render();
  }
}

async function removeTagFromSession(sessionId: string, tag: string): Promise<void> {
  if (!desktopBridge) return;

  try {
    await desktopBridge.rpc.request.removeSessionTag({ sessionId, tag });
    const [sessions, allTags] = await Promise.all([
      desktopBridge.rpc.request.listSessions(undefined).catch((): SessionRecord[] => state.sessions),
      desktopBridge.rpc.request.listAllTags(undefined).catch((): string[] => state.allTags)
    ]);
    state.sessions = sessions;
    state.allTags = allTags;
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Failed to remove tag.") };
  }

  render();
}

async function handleImportZip(): Promise<void> {
  if (!desktopBridge) return;
  if (viewerState.isOpening) return;

  viewerState.isOpening = true;
  state.feedback = { tone: "neutral", text: "Opening ZIP file picker…" };
  render();

  try {
    const payload = await desktopBridge.rpc.request.importZipSession(undefined);
    openViewer(payload);
    state.feedback = { tone: "neutral", text: "ZIP session loaded." };
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Failed to import ZIP session.") };
    render();
  } finally {
    viewerState.isOpening = false;
  }
}

async function handleViewSession(sessionId: string): Promise<void> {
  if (!desktopBridge) return;
  if (viewerState.isOpening) return;

  viewerState.isOpening = true;
  state.feedback = { tone: "neutral", text: "Loading session…" };
  render();

  try {
    const payload = await desktopBridge.rpc.request.loadLibrarySession({ sessionId });
    openViewer(payload);
    state.feedback = { tone: "neutral", text: "Session loaded." };
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Failed to load session.") };
    render();
  } finally {
    viewerState.isOpening = false;
  }
}

function openViewer(payload: ViewerPayload): void {
  const previousPayload = viewerState.payload;
  if (previousPayload && shouldClearViewerTempSession(previousPayload) && desktopBridge) {
    const previousTempId = previousPayload.tempId;
    if (previousTempId !== undefined) {
      void desktopBridge.rpc.request.clearTempSession({ tempId: previousTempId }).catch(() => undefined);
    }
  }

  applyViewerPayload(viewerState, payload);

  renderViewer();
}

async function closeViewer(): Promise<void> {
  const payload = viewerState.payload;

  resetViewerState(viewerState);

  hideContextMenu();
  viewerFocusBtn.hidden = true;
  viewerVideo.pause();
  viewerVideoState.loadVersion += 1;
  viewerVideo.src = "";
  viewerOverlay.dataset.open = "false";
  resetViewerVideoDiagnostics(viewerVideoState);

  if (payload && shouldClearViewerTempSession(payload) && desktopBridge) {
    const tempId = payload.tempId;
    if (tempId !== undefined) {
      await desktopBridge.rpc.request.clearTempSession({ tempId }).catch(() => undefined);
    }
  }
}

function renderViewer(): void {
  const payload = viewerState.payload;
  if (!payload) return;

  viewerOverlay.dataset.open = "true";
  viewerTitle.textContent = payload.archive.name;
  viewerSourceBadge.textContent = getViewerSourceLabel(payload.source);
  viewerSourceBadge.dataset.source = payload.source;

  const recordingArtifact = payload.archive.artifacts.find((artifact) => artifact.kind === "recording.webm");
  void loadViewerVideoSource({
    videoPath: payload.videoPath,
    mimeType: recordingArtifact?.mimeType || "video/webm",
    viewerVideo,
    viewerVideoState,
    desktopBridge,
    getViewerSource: () => viewerState.payload?.source ?? "unknown",
    isViewerOpen: () => viewerState.open,
    onBridgeUnavailable: () => {
      state.feedback = { tone: "error", text: "Desktop bridge unavailable for evidence video loading." };
      render();
    },
    onLoadFailure: (error, diagnostics) => {
      console.warn(formatErrorMessage(error, "Unable to load the evidence video through desktop RPC."), diagnostics);
    }
  });

  const readOnlyNotice = getViewerReadOnlyNotice(payload.source);
  const isReadOnly = !canEditViewerNotes(payload.source);
  if (readOnlyNotice) {
    viewerZipNotice.hidden = false;
    viewerZipNotice.textContent = readOnlyNotice;
  } else {
    viewerZipNotice.hidden = true;
  }
  viewerNotesTextarea.value = viewerState.notesValue;
  viewerNotesTextarea.readOnly = isReadOnly;
  viewerNotesSave.hidden = isReadOnly;
  viewerNotesSave.disabled = !viewerState.notesDirty || viewerState.notesSaving;

  renderViewerSectionTabs();
  renderViewerNetworkFilter();
  renderViewerTimeline();
  renderViewerNetworkDetail();
  renderViewerMergeDialog();
}

function renderViewerTimeline(): void {
  const payload = viewerState.payload;
  if (!payload) {
    viewerTimeline.innerHTML = `<span class="viewer-timeline-empty">No events recorded.</span>`;
    return;
  }

  const section = viewerState.activeSection;
  const items = buildSectionTimeline(payload.archive, section, viewerState.networkSubtypeFilter, viewerState.networkSearchQuery);

  if (section === "actions") {
    const mergedMemberIds = new Set(viewerState.mergeGroups.flatMap((g) => g.memberIds));

    const rows: string[] = [];
    const seenGroupIds = new Set<string>();

    for (const item of items) {
      const group = viewerState.mergeGroups.find((g) => g.memberIds.includes(item.id));

      if (group) {
        if (seenGroupIds.has(group.id)) continue;
        seenGroupIds.add(group.id);

        const memberItems = items.filter((i) => group.memberIds.includes(i.id));
        const firstMs = Math.min(...memberItems.map((i) => i.offsetMs));
        const lastMs = Math.max(...memberItems.map((i) => i.offsetMs));
        const tagChips = group.tags.map((t) => `<span class="tl-tag">${escapeHtml(t)}</span>`).join("");
        const isSelected = viewerState.selectedActionIds.has(group.id);

        rows.push(`<button
          class="timeline-item timeline-item-merged"
          type="button"
          data-role="timeline-item"
          data-item-id="${escapeHtml(group.id)}"
          data-offset-ms="${firstMs}"
          data-section="actions"
          data-merged="true"
          data-active="false"
          data-selected="${isSelected ? "true" : "false"}"
        ><span class="timeline-offset">${escapeHtml(formatOffset(firstMs))}–${escapeHtml(formatOffset(lastMs))}</span><span class="tl-merged-badge">merged</span><span class="timeline-label">${escapeHtml(group.label)}</span>${tagChips ? `<span class="tl-tags">${tagChips}</span>` : ""}</button>`);
        continue;
      }

      if (mergedMemberIds.has(item.id)) continue;

      const isSelected = viewerState.selectedActionIds.has(item.id);
      const tagChips = (item.tags ?? []).map((t) => `<span class="tl-tag">${escapeHtml(t)}</span>`).join("");

      rows.push(`<button
        class="timeline-item"
        type="button"
        data-role="timeline-item"
        data-item-id="${escapeHtml(item.id)}"
        data-offset-ms="${item.offsetMs}"
        data-section="actions"
        data-kind="${escapeHtml(item.kind)}"
        data-active="false"
        data-selected="${isSelected ? "true" : "false"}"
      ><span class="timeline-offset">${escapeHtml(formatOffset(item.offsetMs))}</span><span class="timeline-label">${escapeHtml(item.label)}</span>${tagChips ? `<span class="tl-tags">${tagChips}</span>` : ""}</button>`);
    }

    viewerTimeline.innerHTML = rows.length > 0 ? rows.join("") : `<span class="viewer-timeline-empty">No actions recorded.</span>`;
  } else {
    if (items.length === 0) {
      viewerTimeline.innerHTML = `<span class="viewer-timeline-empty">No ${section} events recorded.</span>`;
      return;
    }

    viewerTimeline.innerHTML = items
      .map((item, idx) => {
        const isActive = idx === viewerState.activeIndex;
        return `<button
          class="timeline-item"
          type="button"
          data-role="timeline-item"
          data-item-id="${escapeHtml(item.id)}"
          data-index="${idx}"
          data-offset-ms="${item.offsetMs}"
          data-section="${escapeHtml(section)}"
          data-kind="${escapeHtml(item.kind)}"
          data-active="${isActive ? "true" : "false"}"
        ><span class="timeline-offset">${escapeHtml(formatOffset(item.offsetMs))}</span><span class="timeline-label">${escapeHtml(item.label)}</span></button>`;
      })
      .join("");
  }
}

function updateTimelineHighlight(): void {
  const payload = viewerState.payload;
  if (!payload) return;

  const section = viewerState.activeSection;
  const items = buildSectionTimeline(payload.archive, section, viewerState.networkSubtypeFilter, viewerState.networkSearchQuery);
  const currentTimeMs = viewerVideo.currentTime * 1000;
  const nextActive = findActiveIndex(items, currentTimeMs);
  viewerState.activeIndex = nextActive;

  const buttons = viewerTimeline.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item']");
  let activeBtn: HTMLButtonElement | null = null;

  const activeItemId = (() => {
    const activeItem = nextActive >= 0 ? items[nextActive] : undefined;
    if (!activeItem) return null;
    if (section !== "actions") return activeItem.id;
    return viewerState.mergeGroups.find((group) => group.memberIds.includes(activeItem.id))?.id ?? activeItem.id;
  })();

  buttons.forEach((btn, idx) => {
    const isActive = section === "actions" ? btn.dataset.itemId === activeItemId : idx === nextActive;
    btn.dataset.active = isActive ? "true" : "false";
    if (isActive) activeBtn = btn;
  });

  if (viewerState.autoFollow && activeBtn !== null) {
    isAutoScrolling = true;
    (activeBtn as HTMLButtonElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => { isAutoScrolling = false; }, 300);
  }
}

function renderViewerSectionTabs(): void {
  viewerSectionTabs.querySelectorAll<HTMLButtonElement>("[data-role='section-tab']").forEach((tab) => {
    tab.dataset.active = tab.dataset.section === viewerState.activeSection ? "true" : "false";
  });
}

function renderViewerNetworkFilter(): void {
  const isNetwork = viewerState.activeSection === "network";
  viewerNetworkFilter.hidden = !isNetwork;
  viewerNetworkFilter.style.display = isNetwork ? "flex" : "none";
  viewerNetworkSearch.value = viewerState.networkSearchQuery;
  if (!isNetwork) return;
  viewerNetworkFilter.querySelectorAll<HTMLButtonElement>("[data-role='subtype-filter']").forEach((btn) => {
    btn.dataset.active = btn.dataset.subtype === viewerState.networkSubtypeFilter ? "true" : "false";
  });
}

function hideContextMenu(): void {
  viewerContextMenu.hidden = true;
  contextTargetId = null;
}

function renderViewerMergeDialog(): void {
  viewerMergeDialogBackdrop.hidden = !viewerState.mergeDialogOpen;
  viewerMergeDialogInput.value = viewerState.mergeDialogValue;
  viewerMergeDialogError.hidden = viewerState.mergeDialogError === null;
  viewerMergeDialogError.textContent = viewerState.mergeDialogError ?? "";

  if (viewerState.mergeDialogOpen) {
    queueMicrotask(() => viewerMergeDialogInput.focus());
  }
}

function openViewerMergeDialog(selectedActionIds: string[]): void {
  viewerState.pendingMergeActionIds = selectedActionIds;
  viewerState.mergeDialogValue = `Merged ${selectedActionIds.length} actions`;
  viewerState.mergeDialogError = null;
  viewerState.mergeDialogOpen = true;
  renderViewerMergeDialog();
}

function closeViewerMergeDialog(): void {
  viewerState.mergeDialogOpen = false;
  viewerState.mergeDialogValue = "";
  viewerState.mergeDialogError = null;
  viewerState.pendingMergeActionIds = [];
  renderViewerMergeDialog();
}

function submitViewerMergeDialog(): void {
  const label = viewerState.mergeDialogValue.trim();
  if (viewerState.pendingMergeActionIds.length < 2) {
    viewerState.mergeDialogError = "Select at least two actions before merging.";
    renderViewerMergeDialog();
    return;
  }

  if (!label) {
    viewerState.mergeDialogError = "Enter a name for the merged action.";
    renderViewerMergeDialog();
    return;
  }

  const group: ActionMergeGroup = {
    id: `mg-${Date.now()}`,
    kind: "merge-group",
    memberIds: viewerState.pendingMergeActionIds,
    tags: [],
    label,
    createdAt: new Date().toISOString()
  };
  viewerState.mergeGroups = [...viewerState.mergeGroups, group];
  viewerState.selectedActionIds = new Set();
  closeViewerMergeDialog();
  void persistViewerReviewState("Merged actions.");
}

function renderViewerNetworkDetail(): void {
  const idx = viewerState.networkDetailIndex;
  if (idx === null) {
    viewerNetworkDetail.hidden = true;
    return;
  }

  const item = viewerState.timeline[idx];
  if (!item || item.kind !== "network") {
    viewerNetworkDetail.hidden = true;
    return;
  }

  const p = item.payload;
  if (p.kind !== "network") {
    viewerNetworkDetail.hidden = true;
    return;
  }

  viewerNetworkDetail.hidden = false;

  const statusCode = p.status ?? null;
  const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 300;
  const isError = statusCode !== null && statusCode >= 400;
  const statusClass = isSuccess ? "network-status-success" : isError ? "network-status-error" : "";
  const statusText = statusCode !== null ? `${statusCode}${p.statusText ? ` ${p.statusText}` : ""}` : "—";
  const durationText = p.durationMs !== undefined ? `${p.durationMs.toFixed(0)} ms` : "—";

  const reqHeaders = p.request.headers
    .map(
      (h) => `<div class="network-header-row">${renderCopyableValue(h.name, "header name", "network-header-name")} ${renderCopyableValue(h.value, "header value", "network-header-value")}</div>`
    )
    .join("");

  const resHeaders = (p.response?.headers ?? [])
    .map(
      (h) => `<div class="network-header-row">${renderCopyableValue(h.name, "header name", "network-header-name")} ${renderCopyableValue(h.value, "header value", "network-header-value")}</div>`
    )
    .join("");

  const reqBody = p.request.body
    ? renderBodyCapture(p.request.body)
    : `<span class="network-body-empty">No request body</span>`;

  const resBody = p.response?.body
    ? renderBodyCapture(p.response.body)
    : `<span class="network-body-empty">No response body</span>`;

  viewerNetworkDetailBody.innerHTML = `
    <div class="network-detail-section">
      <span class="network-detail-label">Request</span>
      <div class="network-detail-row"><span class="network-detail-key">Method</span>${renderCopyableValue(p.method, "request method", "network-detail-val")}</div>
      <div class="network-detail-row"><span class="network-detail-key">URL</span>${renderCopyableValue(p.url, "request URL", "network-detail-val network-url")}</div>
      <div class="network-detail-row"><span class="network-detail-key">Status</span>${renderCopyableValue(statusText, "response status", `network-detail-val ${statusClass}`)}</div>
      <div class="network-detail-row"><span class="network-detail-key">Duration</span>${renderCopyableValue(durationText, "request duration", "network-detail-val")}</div>
      ${p.failureText ? `<div class="network-detail-row"><span class="network-detail-key">Failure</span>${renderCopyableValue(p.failureText, "failure message", "network-detail-val network-status-error")}</div>` : ""}
    </div>
    <div class="network-detail-section">
      <span class="network-detail-label">Request headers</span>
      ${reqHeaders || `<span class="network-body-empty">No headers</span>`}
    </div>
    <div class="network-detail-section">
      <span class="network-detail-label">Request body</span>
      ${reqBody}
    </div>
    <div class="network-detail-section">
      <span class="network-detail-label">Response headers</span>
      ${resHeaders || `<span class="network-body-empty">No headers</span>`}
    </div>
    <div class="network-detail-section">
      <span class="network-detail-label">Response body</span>
      ${resBody}
    </div>
  `;
}

function renderBodyCapture(body: { disposition: string; encoding?: "utf8" | "base64" | undefined; mimeType?: string | undefined; value?: string | undefined; byteLength?: number | undefined; omittedByteLength?: number | undefined; reason?: string | undefined }): string {
  if (body.disposition === "captured" && body.value !== undefined) {
    const display = body.encoding === "base64"
      ? `[base64, ${body.byteLength ?? "?"} bytes]`
      : escapeHtml(body.value.slice(0, 2000));
    return `<button class="network-copy-block" type="button" data-role="copy-value" data-copy-label="request detail" data-copy-value="${escapeHtml(body.value)}"><pre class="network-body-pre">${display}</pre></button>`;
  }
  const reason = body.reason ? ` (${body.reason})` : "";
  return `<span class="network-body-empty">${escapeHtml(body.disposition)}${escapeHtml(reason)}</span>`;
}

function renderCopyableValue(value: string, label: string, className: string): string {
  return `<button class="network-copy-inline ${className}" type="button" data-role="copy-value" data-copy-label="${escapeHtml(label)}" data-copy-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`;
}

async function copyViewerValue(value: string, label: string): Promise<void> {
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

    state.feedback = { tone: "success", text: `Copied ${label}.` };
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, `Failed to copy ${label}.`) };
  }

  render();
}

async function saveViewerNotes(): Promise<void> {
  const payload = viewerState.payload;
  if (!payload || !shouldPersistViewerReviewState(payload.source) || !desktopBridge) return;

  viewerState.notesSaving = true;
  viewerNotesSave.disabled = true;
  viewerNotesSave.textContent = "Saving…";

  try {
    await persistViewerReviewState("Notes saved.");
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Failed to save notes.") };
    render();
  } finally {
    viewerState.notesSaving = false;
    viewerNotesSave.textContent = "Save notes";
    viewerNotesSave.disabled = !viewerState.notesDirty;
  }
}

function getSelectedActionEntryIds(): string[] {
  const payload = viewerState.payload;
  if (!payload) {
    return [];
  }

  return getContiguousMergeableActionIds(payload.archive, viewerState.mergeGroups, viewerState.selectedActionIds);
}

async function persistViewerReviewState(successText?: string): Promise<void> {
  const payload = viewerState.payload;
  if (!payload) return;

  if (!shouldPersistViewerReviewState(payload.source) || !desktopBridge) {
    renderViewerTimeline();
    renderViewerNetworkDetail();
    if (successText) {
      state.feedback = { tone: "neutral", text: successText };
      render();
    }
    return;
  }

  const response = await desktopBridge.rpc.request.saveSessionReviewState({
    sessionId: payload.archive.sessionId,
    notes: viewerState.notesValue,
    annotations: viewerState.mergeGroups
  });

  viewerState.notesDirty = false;
  viewerState.payload = {
    ...payload,
    archive: response.archive,
    notes: viewerState.notesValue
  };
  viewerState.timeline = buildTimeline(response.archive);
  viewerState.mergeGroups = response.archive.annotations.filter((annotation): annotation is ActionMergeGroup => annotation.kind === "merge-group");
  renderViewerTimeline();
  renderViewerNetworkDetail();

  if (successText) {
    state.feedback = { tone: "success", text: successText };
    render();
  }
}

async function handleOpenLocalSession(): Promise<void> {
  if (!desktopBridge) return;
  if (viewerState.isOpening) return;
  viewerState.isOpening = true;
  state.feedback = { tone: "neutral", text: "Opening local session folder…" };
  render();
  try {
    const payload = await desktopBridge.rpc.request.openLocalSession(undefined);
    openViewer(payload);
    state.feedback = { tone: "neutral", text: "Local session loaded." };
    render();
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Failed to open local session.") };
    render();
  } finally {
    viewerState.isOpening = false;
  }
}

async function handleExportSessionZip(sessionId: string): Promise<void> {
  if (!desktopBridge) return;
  state.feedback = { tone: "neutral", text: "Exporting session ZIP…" };
  render();
  try {
    const { savedPath } = await desktopBridge.rpc.request.exportSessionZip({ sessionId });
    state.feedback = { tone: "success", text: `ZIP exported → ${savedPath}` };
  } catch (error) {
    state.feedback = { tone: "error", text: formatErrorMessage(error, "Failed to export session ZIP.") };
  }
  render();
}

render();
