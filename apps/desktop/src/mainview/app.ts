import { Electroview } from "electrobun/view";

import type { DesktopCompanionConfigSnapshot, DesktopCompanionRuntimeSnapshot, DesktopRPC, SessionRecord, ViewerPayload } from "../rpc";
import { buildSectionTimeline, buildTimeline, buildVisibleActionRangeSelection, findActiveIndex, formatOffset, getContiguousMergeableActionIds } from "./timeline";
import type { TimelineItem, TimelineSection } from "./timeline";
import type { ActionMergeGroup, ArchiveAnnotation, NetworkSubtype } from "@jittle-lamp/shared";

type DesktopBridge = {
  rpc: {
    request: {
      addSessionTag(params: { sessionId: string; tag: string }): Promise<{ ok: true }>;
      chooseOutputDirectory(params: { startingFolder: string }): Promise<{ selectedPath: string | null }>;
      clearTempSession(params: { tempId: string }): Promise<{ ok: true }>;
      deleteSession(params: { sessionId: string }): Promise<{ ok: true }>;
      exitApp(params: undefined): Promise<{ ok: true }>;
      getCompanionConfig(params: undefined): Promise<DesktopCompanionConfigSnapshot>;
      getCompanionRuntime(params: undefined): Promise<DesktopCompanionRuntimeSnapshot>;
      exportSessionZip(params: { sessionId: string }): Promise<{ savedPath: string }>;
      getVideoPlaybackUrl(params: { videoPath: string; mimeType: string }): Promise<{ url: string }>;
      importZipSession(params: undefined): Promise<ViewerPayload>;
      listAllTags(params: undefined): Promise<string[]>;
      openLocalSession(params: undefined): Promise<ViewerPayload>;
      listSessions(params: undefined): Promise<SessionRecord[]>;
      loadLibrarySession(params: { sessionId: string }): Promise<ViewerPayload>;
      openPath(params: { path: string }): Promise<{ ok: true }>;
      removeSessionTag(params: { sessionId: string; tag: string }): Promise<{ ok: true }>;
      saveOutputDirectory(params: { outputDir: string }): Promise<DesktopCompanionConfigSnapshot>;
      setSessionNotes(params: { sessionId: string; notes: string }): Promise<{ ok: true }>;
      saveSessionReviewState(params: { sessionId: string; notes: string; annotations: ArchiveAnnotation[] }): Promise<{ ok: true; archive: ViewerPayload["archive"] }>;
    };
  };
};

type DatePreset = "today" | "week" | "month" | "all";
type FeedbackTone = "neutral" | "success" | "error";

type ViewerState = {
  open: boolean;
  payload: ViewerPayload | null;
  timeline: TimelineItem[];
  activeIndex: number;
  networkDetailIndex: number | null;
  notesValue: string;
  notesSaving: boolean;
  notesDirty: boolean;
  isOpening: boolean;
  activeSection: TimelineSection;
  networkSubtypeFilter: NetworkSubtype | "all";
  autoFollow: boolean;
  selectedActionIds: Set<string>;
  anchorActionId: string | null;
  mergeGroups: ActionMergeGroup[];
};

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

type VideoDiagnostics = {
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

const runtimePollIntervalMs = 2_000;
const desktopBridge = createDesktopBridge();
let pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null;
let viewerVideoLoadVersion = 0;
let viewerVideoEventLog: VideoEventLogEntry[] = [];
let lastVideoLoadAttempt: VideoLoadAttempt | null = null;
let isAutoScrolling = false;

const viewerState: ViewerState = {
  open: false,
  payload: null,
  timeline: [],
  activeIndex: -1,
  networkDetailIndex: null,
  notesValue: "",
  notesSaving: false,
  notesDirty: false,
  isOpening: false,
  activeSection: "actions",
  networkSubtypeFilter: "all",
  autoFollow: true,
  selectedActionIds: new Set(),
  anchorActionId: null,
  mergeGroups: []
};

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
      </div>
    </div>
  </div>
`;

const runtimePill = queryElement<HTMLSpanElement>("[data-role='runtime-pill']");
const outputPath = queryElement<HTMLSpanElement>("[data-role='output-path']");
const gearBtn = queryElement<HTMLButtonElement>("[data-role='gear-btn']");
const importZipBtn = queryElement<HTMLButtonElement>("[data-role='import-zip-btn']");
const openLocalBtn = queryElement<HTMLButtonElement>("[data-role='open-local-btn']");
const tagFilterWrapper = queryElement<HTMLDivElement>("[data-role='tag-filter-wrapper']");
const resultsCount = queryElement<HTMLSpanElement>("[data-role='results-count']");
const feedback = queryElement<HTMLDivElement>("[data-role='feedback']");
const sessionsScroll = queryElement<HTMLDivElement>("[data-role='sessions-scroll']");
const drawerOverlay = queryElement<HTMLDivElement>("[data-role='drawer-overlay']");
const settingsDrawer = queryElement<HTMLDivElement>("[data-role='settings-drawer']");
const drawerClose = queryElement<HTMLButtonElement>("[data-role='drawer-close']");
const currentOutputDir = queryElement<HTMLDivElement>("[data-role='current-output-dir']");
const effectiveSummary = queryElement<HTMLParagraphElement>("[data-role='effective-summary']");
const envOverrideWarning = queryElement<HTMLDivElement>("[data-role='env-override-warning']");
const outputDirField = queryElement<HTMLInputElement>("[data-role='output-dir-field']");
const chooseButton = queryElement<HTMLButtonElement>("[data-role='choose-button']");
const saveButton = queryElement<HTMLButtonElement>("[data-role='save-button']");
const openOutputButton = queryElement<HTMLButtonElement>("[data-role='open-output-button']");
const openConfigButton = queryElement<HTMLButtonElement>("[data-role='open-config-button']");
const detailSource = queryElement<HTMLElement>("[data-role='detail-source']");
const detailSavedOutput = queryElement<HTMLElement>("[data-role='detail-saved-output']");
const detailDefaultOutput = queryElement<HTMLElement>("[data-role='detail-default-output']");
const detailConfigPath = queryElement<HTMLElement>("[data-role='detail-config-path']");

const viewerOverlay = queryElement<HTMLDivElement>("[data-role='viewer-overlay']");
const viewerClose = queryElement<HTMLButtonElement>("[data-role='viewer-close']");
const viewerTitle = queryElement<HTMLSpanElement>("[data-role='viewer-title']");
const viewerSourceBadge = queryElement<HTMLSpanElement>("[data-role='viewer-source-badge']");
const viewerVideo = queryElement<HTMLVideoElement>("[data-role='viewer-video']");
const viewerTimeline = queryElement<HTMLDivElement>("[data-role='viewer-timeline']");
const viewerZipNotice = queryElement<HTMLDivElement>("[data-role='viewer-zip-notice']");
const viewerNotesTextarea = queryElement<HTMLTextAreaElement>("[data-role='viewer-notes-textarea']");
const viewerNotesSave = queryElement<HTMLButtonElement>("[data-role='viewer-notes-save']");
const viewerNetworkDetail = queryElement<HTMLDivElement>("[data-role='viewer-network-detail']");
const viewerDetailClose = queryElement<HTMLButtonElement>("[data-role='viewer-detail-close']");
const viewerNetworkDetailBody = queryElement<HTMLDivElement>("[data-role='viewer-network-detail-body']");
const viewerSectionTabs = queryElement<HTMLDivElement>("[data-role='viewer-section-tabs']");
const viewerNetworkFilter = queryElement<HTMLDivElement>("[data-role='viewer-network-filter']");
const viewerSectionBody = queryElement<HTMLDivElement>("[data-role='viewer-section-body']");
const viewerFocusBtn = queryElement<HTMLButtonElement>("[data-role='viewer-focus-btn']");
const viewerContextMenu = queryElement<HTMLDivElement>("[data-role='viewer-context-menu']");
const ctxMergeBtn = queryElement<HTMLButtonElement>("[data-role='ctx-merge']");
const ctxUnmergeBtn = queryElement<HTMLButtonElement>("[data-role='ctx-unmerge']");

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
    recordViewerVideoEvent(mediaEventName);
  });
}

viewerVideo.addEventListener("error", () => {
  const diagnostics = collectViewerVideoDiagnostics("error-event");

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
        return;
      }
    }

    viewerState.selectedActionIds = new Set([itemId]);
    viewerState.anchorActionId = itemId;
    renderViewerTimeline();
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
});

viewerNetworkFilter.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const btn = event.target.closest<HTMLButtonElement>("[data-role='subtype-filter']");
  if (!btn) return;
  const subtype = btn.dataset.subtype as NetworkSubtype | "all" | undefined;
  if (!subtype) return;
  viewerState.networkSubtypeFilter = subtype;
  renderViewerNetworkFilter();
  renderViewerTimeline();
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
  const label = prompt("Merge group label:");
  if (!label?.trim()) return;

  const selectedActionIds = getSelectedActionEntryIds();
  if (selectedActionIds.length < 2) {
    state.feedback = { tone: "error", text: "Select at least two actions before merging." };
    render();
    return;
  }

  const group: ActionMergeGroup = {
    id: `mg-${Date.now()}`,
    kind: "merge-group",
    memberIds: selectedActionIds,
    tags: [],
    label: label.trim(),
    createdAt: new Date().toISOString()
  };
  viewerState.mergeGroups = [...viewerState.mergeGroups, group];
  viewerState.selectedActionIds = new Set();
  void persistViewerReviewState("Merged actions.");
});

ctxUnmergeBtn.addEventListener("click", () => {
  hideContextMenu();
  const targetId = [...viewerState.selectedActionIds][0];
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
    if (viewerState.open) {
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
  if (state.tagFilter !== null) {
    tagFilterWrapper.innerHTML = `
      <span class="active-tag-chip">
        ${escapeHtml(state.tagFilter)}
        <button class="tag-chip-remove" type="button" data-role="tag-filter-remove" aria-label="Remove tag filter">✕</button>
      </span>
    `;
    return;
  }

  const existingInput = tagFilterWrapper.querySelector<HTMLInputElement>("[data-role='tag-filter-input']");
  if (existingInput) {
    return;
  }

  tagFilterWrapper.innerHTML = `
    <input
      class="tag-filter-input"
      type="text"
      placeholder="Filter by tag…"
      data-role="tag-filter-input"
      autocomplete="off"
    />
    <div class="tag-autocomplete" data-role="tag-filter-autocomplete" hidden></div>
  `;
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
  autocomplete.innerHTML = matches
    .map(
      (t) =>
        `<button class="tag-option" type="button" data-role="tag-filter-option" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
    )
    .join("");

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
  if (filtered.length === 0) {
    sessionsScroll.innerHTML = `
      <div class="empty-state">
        <span>No sessions found.</span>
        <span class="empty-hint">Start a browser recording with the extension to populate this list.</span>
      </div>
    `;
    return;
  }

  sessionsScroll.innerHTML = filtered
    .map((session) => {
      const shortId =
        session.sessionId.length > 24
          ? `${session.sessionId.slice(0, 10)}…${session.sessionId.slice(-8)}`
          : session.sessionId;

      const hasWebm = session.artifacts.some((a) => a.artifactName === "recording.webm");
      const hasJson = session.artifacts.some((a) => a.artifactName === "session.archive.json");
      const isPending = state.pendingDeleteId === session.sessionId;
      const isEditing = state.editingTagSessionId === session.sessionId;

      const tagChips = session.tags
        .map(
          (tag) =>
            `<span class="tag-chip">${escapeHtml(tag)}<button class="tag-chip-x" type="button" data-role="tag-chip-x" data-session-id="${escapeHtml(session.sessionId)}" data-tag="${escapeHtml(tag)}" aria-label="Remove tag ${escapeHtml(tag)}">✕</button></span>`
        )
        .join("");

      const tagEditor = isEditing
        ? `<div class="tag-editor-wrap">
            <input
              class="tag-input-inline"
              type="text"
              data-role="tag-input-inline"
              data-session-id="${escapeHtml(session.sessionId)}"
              value="${escapeHtml(state.tagInputValue)}"
              placeholder="tag name"
              autocomplete="off"
            />
            <div class="tag-autocomplete" data-role="tag-inline-autocomplete" data-session-id="${escapeHtml(session.sessionId)}" hidden></div>
          </div>`
        : `<button class="tag-add-btn" type="button" data-role="tag-add-btn" data-session-id="${escapeHtml(session.sessionId)}">+ tag</button>`;

      return `
        <article class="session-card">
          <div class="session-head">
            <span class="session-id" title="${escapeHtml(session.sessionId)}">${escapeHtml(shortId)}</span>
            <span class="session-time">${escapeHtml(formatRelativeTime(session.recordedAt))}</span>
          </div>
          <div class="session-artifacts">
            <span class="artifact-tag ${hasWebm ? "artifact-present" : "artifact-missing"}">webm</span>
            <span class="artifact-tag ${hasJson ? "artifact-present" : "artifact-missing"}">json</span>
            <span class="session-size">${escapeHtml(formatBytes(session.totalBytes))}</span>
          </div>
          <div class="session-tags">
            ${tagChips}
            ${tagEditor}
          </div>
          <p class="session-path">${escapeHtml(session.sessionFolder)}</p>
          <div class="session-actions">
            <button class="button ghost sm" type="button" data-role="session-view-btn" data-session-id="${escapeHtml(session.sessionId)}">View</button>
            <button class="button ghost sm" type="button" data-role="session-open-btn" data-session-id="${escapeHtml(session.sessionId)}">Open</button>
            <button class="button ghost sm" type="button" data-role="session-zip-btn" data-session-id="${escapeHtml(session.sessionId)}">ZIP</button>
            <button class="button ghost sm${isPending ? " session-delete-confirm" : ""}" type="button" data-role="session-delete-btn" data-session-id="${escapeHtml(session.sessionId)}">
              ${isPending ? "Confirm?" : "Delete"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

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
  autocomplete.innerHTML = matches
    .map(
      (t) =>
        `<button class="tag-option" type="button" data-role="tag-inline-option" data-session-id="${escapeHtml(sessionId)}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
    )
    .join("");
}

function getFilteredSessions(): SessionRecord[] {
  const now = Date.now();
  const dayMs = 86_400_000;

  return state.sessions.filter((session) => {
    if (state.tagFilter !== null) {
      if (!session.tags.includes(state.tagFilter)) return false;
    }

    if (state.dateFilter !== "all") {
      const recordedAt = new Date(session.recordedAt).getTime();
      if (Number.isNaN(recordedAt)) return false;

      if (state.dateFilter === "today") {
        if (now - recordedAt > dayMs) return false;
      } else if (state.dateFilter === "week") {
        if (now - recordedAt > 7 * dayMs) return false;
      } else if (state.dateFilter === "month") {
        if (now - recordedAt > 30 * dayMs) return false;
      }
    }

    return true;
  });
}

function isDatePreset(value: string | undefined): value is DatePreset {
  return value === "today" || value === "week" || value === "month" || value === "all";
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
  if (previousPayload?.source === "zip" && previousPayload.tempId !== undefined && desktopBridge) {
    void desktopBridge.rpc.request.clearTempSession({ tempId: previousPayload.tempId }).catch(() => undefined);
  }

  viewerState.open = true;
  viewerState.payload = payload;
  viewerState.timeline = buildTimeline(payload.archive);
  viewerState.activeIndex = -1;
  viewerState.networkDetailIndex = null;
  viewerState.notesValue = payload.notes;
  viewerState.notesDirty = false;
  viewerState.notesSaving = false;
  viewerState.activeSection = "actions";
  viewerState.networkSubtypeFilter = "all";
  viewerState.autoFollow = true;
  viewerState.selectedActionIds = new Set();
  viewerState.anchorActionId = null;
  viewerState.mergeGroups = (payload.archive.annotations ?? []).filter(
    (a): a is ActionMergeGroup => a.kind === "merge-group"
  );

  renderViewer();
}

async function closeViewer(): Promise<void> {
  const payload = viewerState.payload;

  viewerState.open = false;
  viewerState.payload = null;
  viewerState.timeline = [];
  viewerState.activeIndex = -1;
  viewerState.networkDetailIndex = null;
  viewerState.notesValue = "";
  viewerState.notesDirty = false;
  viewerState.notesSaving = false;
  viewerState.activeSection = "actions";
  viewerState.networkSubtypeFilter = "all";
  viewerState.autoFollow = true;
  viewerState.selectedActionIds = new Set();
  viewerState.anchorActionId = null;
  viewerState.mergeGroups = [];

  hideContextMenu();
  viewerFocusBtn.hidden = true;
  viewerVideo.pause();
  viewerVideoLoadVersion += 1;
  viewerVideo.src = "";
  viewerOverlay.dataset.open = "false";
  resetViewerVideoDiagnostics();

  if (payload?.source === "zip" && payload.tempId !== undefined && desktopBridge) {
    await desktopBridge.rpc.request.clearTempSession({ tempId: payload.tempId }).catch(() => undefined);
  }
}

function renderViewer(): void {
  const payload = viewerState.payload;
  if (!payload) return;

  viewerOverlay.dataset.open = "true";
  viewerTitle.textContent = payload.archive.name;
  const sourceLabels: Record<string, string> = { library: "Library", zip: "ZIP", local: "Local" };
  viewerSourceBadge.textContent = sourceLabels[payload.source] ?? payload.source;
  viewerSourceBadge.dataset.source = payload.source;

  const recordingArtifact = payload.archive.artifacts.find((artifact) => artifact.kind === "recording.webm");
  void loadViewerVideoSource(payload.videoPath, recordingArtifact?.mimeType || "video/webm");

  const isReadOnly = payload.source !== "library";
  if (payload.source === "local") {
    viewerZipNotice.hidden = false;
    viewerZipNotice.textContent = "Local session — notes are read-only and not persisted.";
  } else if (payload.source === "zip") {
    viewerZipNotice.hidden = false;
    viewerZipNotice.textContent = "Notes are read-only for ZIP imports and are not saved.";
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
}

function renderViewerTimeline(): void {
  const payload = viewerState.payload;
  if (!payload) {
    viewerTimeline.innerHTML = `<span class="viewer-timeline-empty">No events recorded.</span>`;
    return;
  }

  const section = viewerState.activeSection;
  const items = buildSectionTimeline(payload.archive, section, viewerState.networkSubtypeFilter);

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
  if (section === "actions") return;

  const items = buildSectionTimeline(payload.archive, section, viewerState.networkSubtypeFilter);
  const currentTimeMs = viewerVideo.currentTime * 1000;
  const nextActive = findActiveIndex(items, currentTimeMs);
  viewerState.activeIndex = nextActive;

  const buttons = viewerTimeline.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item']");
  let activeBtn: HTMLButtonElement | null = null;

  buttons.forEach((btn, idx) => {
    const isActive = idx === nextActive;
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
  if (!isNetwork) return;
  viewerNetworkFilter.querySelectorAll<HTMLButtonElement>("[data-role='subtype-filter']").forEach((btn) => {
    btn.dataset.active = btn.dataset.subtype === viewerState.networkSubtypeFilter ? "true" : "false";
  });
}

function hideContextMenu(): void {
  viewerContextMenu.hidden = true;
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

async function loadViewerVideoSource(videoPath: string, mimeType: string): Promise<void> {
  const loadVersion = ++viewerVideoLoadVersion;

  resetViewerVideoDiagnostics();
  viewerVideo.removeAttribute("src");
  viewerVideo.load();

  if (!desktopBridge) {
    state.feedback = { tone: "error", text: "Desktop bridge unavailable for evidence video loading." };
    render();
    return;
  }

  try {
    logViewerVideoAttempt({
      videoPath,
      mimeType,
      source: viewerState.payload?.source ?? "unknown",
      attemptKind: "media-url",
      loadVersion
    });

    const { url } = await desktopBridge.rpc.request.getVideoPlaybackUrl({ videoPath, mimeType });

    console.info("[jittle-lamp][viewer-video] fetched video bytes", {
      loadVersion,
      mimeType,
      url
    });

    if (loadVersion !== viewerVideoLoadVersion || !viewerState.open) {
      return;
    }

    lastVideoLoadAttempt = {
      videoPath,
      mimeType,
      source: viewerState.payload?.source ?? "unknown",
      attemptKind: "media-url",
      loadVersion
    };
    viewerVideo.src = url;
    console.info("[jittle-lamp][viewer-video] loading media url", collectViewerVideoDiagnostics("media-url-load"));
    viewerVideo.load();
    return;
  } catch (error) {
    console.warn(formatErrorMessage(error, "Unable to load the evidence video through desktop RPC."), collectViewerVideoDiagnostics("media-url-rpc-failure"));
  }
}

function resetViewerVideoDiagnostics(): void {
  viewerVideoEventLog = [];
  lastVideoLoadAttempt = null;
}

function logViewerVideoAttempt(input: VideoLoadAttempt): void {
  lastVideoLoadAttempt = input;
  console.info("[jittle-lamp][viewer-video] source attempt", {
    ...input,
    canPlayType: viewerVideo.canPlayType(input.mimeType),
    networkState: viewerVideo.networkState,
    readyState: viewerVideo.readyState,
    currentSrc: viewerVideo.currentSrc,
    currentSrcKind: classifyVideoSrc(viewerVideo.currentSrc)
  });
}

function recordViewerVideoEvent(event: string): void {
  viewerVideoEventLog.push({
    event,
    at: new Date().toISOString(),
    networkState: viewerVideo.networkState,
    readyState: viewerVideo.readyState,
    currentTime: viewerVideo.currentTime,
    currentSrcKind: classifyVideoSrc(viewerVideo.currentSrc)
  });

  if (viewerVideoEventLog.length > 20) {
    viewerVideoEventLog = viewerVideoEventLog.slice(-20);
  }
}

function collectViewerVideoDiagnostics(reason: string): VideoDiagnostics {
  const error = viewerVideo.error;

  return {
    reason,
    requestedMimeType: lastVideoLoadAttempt?.mimeType ?? null,
    canPlayRequestedType: lastVideoLoadAttempt?.mimeType
      ? viewerVideo.canPlayType(lastVideoLoadAttempt.mimeType)
      : "",
    canPlayWebm: viewerVideo.canPlayType("video/webm"),
    canPlayVp8: viewerVideo.canPlayType("video/webm;codecs=vp8"),
    canPlayVp9: viewerVideo.canPlayType("video/webm;codecs=vp9"),
    lastAttempt: lastVideoLoadAttempt,
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
    recentEvents: [...viewerVideoEventLog]
  };
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

async function saveViewerNotes(): Promise<void> {
  const payload = viewerState.payload;
  if (!payload || payload.source !== "library" || !desktopBridge) return;

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

  if (payload.source !== "library" || !desktopBridge) {
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

function formatSourceLabel(source: DesktopCompanionConfigSnapshot["source"]): string {
  switch (source) {
    case "env":
      return "Environment override";
    case "file":
      return "Saved file";
    case "default":
      return "Default";
  }
}

function formatRuntimeLabel(status?: DesktopCompanionRuntimeSnapshot["status"]): string {
  switch (status) {
    case "listening":
      return "Online";
    case "error":
      return "Error";
    case "starting":
    default:
      return "Starting";
  }
}

function formatRelativeTime(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;

  const deltaSeconds = Math.round((parsed.getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(deltaSeconds) < 60) return formatter.format(deltaSeconds, "second");

  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) return formatter.format(deltaMinutes, "minute");

  const deltaHours = Math.round(deltaMinutes / 60);
  return formatter.format(deltaHours, "hour");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
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

function queryElement<T extends Element>(selector: string): T {
  const element = appRoot.querySelector<T>(selector);
  if (!element) throw new Error(`Desktop main view element not found for selector: ${selector}`);
  return element;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createDesktopBridge(): DesktopBridge | null {
  try {
    const rpc = Electroview.defineRPC<DesktopRPC>({
      maxRequestTime: 10_000,
      handlers: {
        requests: {},
        messages: {}
      }
    });

    new Electroview({ rpc });

    return {
      rpc: {
        request: rpc.request as DesktopBridge["rpc"]["request"]
      }
    };
  } catch {
    return null;
  }
}

render();
