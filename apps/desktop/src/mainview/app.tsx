import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { findActiveIndex, formatOffset, type TimelineSection } from "@jittle-lamp/shared";
import {
  createMergeGroup,
  deriveSectionTimeline,
  deriveTimeline,
  getArchiveMergeGroups,
  getContiguousMergeableSelection,
  openMergeDialog as openMergeDialogState,
  closeMergeDialog as closeMergeDialogState,
  selectActionRange,
  selectSingleAction,
  toggleActionSelection,
  validateMergeDialog
} from "@jittle-lamp/viewer-core";
import {
  HashRouter,
  NavLink,
  Outlet,
  useLocation,
  useNavigate
} from "react-router";
import { useRoutes } from "react-router";
import type { JittleRouteObject } from "@jittle-lamp/viewer-react";

import type { DesktopCompanionConfigSnapshot, DesktopCompanionRuntimeSnapshot, SessionRecord, ViewerPayload } from "../rpc";
import { createDesktopBridge, type DesktopBridge } from "./desktop-bridge";
import {
  filterSessions,
  formatRuntimeLabel,
  formatSourceLabel,
  type DatePreset
} from "./catalog-view";
import { createDesktopNotesAdapter, createDesktopShareAdapter, createDesktopStorageAdapter } from "./adapters";
import { formatBytes, formatErrorMessage, formatRelativeTime } from "./utils";
import {
  collectViewerVideoDiagnostics,
  createViewerVideoState,
  loadViewerVideoSource,
  recordViewerVideoEvent,
  resetViewerVideoDiagnostics,
  type ViewerVideoState
} from "./viewer-video";
import { applyViewerPayload, createViewerState, resetViewerState, type ViewerState } from "./viewer-state";
import { getViewerSourceLabel, shouldClearViewerTempSession } from "./viewer-source";
import { ViewerPane } from "./viewer-pane";
import { reportDesktopViewerTelemetry } from "./viewer-rollout";

type FeedbackTone = "neutral" | "success" | "error";

type ViewState = {
  bridgeError: string | null;
  config: DesktopCompanionConfigSnapshot | null;
  runtime: DesktopCompanionRuntimeSnapshot | null;
  sessions: SessionRecord[];
  allTags: string[];
  dateFilter: DatePreset;
  tagFilter: string | null;
  editingTagSessionId: string | null;
  tagInputValue: string;
  pendingDeleteId: string | null;
  draftOutputDir: string;
  feedback: { text: string; tone: FeedbackTone };
  isChoosingFolder: boolean;
  isLoading: boolean;
  isSaving: boolean;
};

type TimelineRow = {
  id: string;
  offsetMs: number;
  section: TimelineSection;
  label: string;
  kind: string;
  selected: boolean;
  merged: boolean;
  mergedRange?: string;
  tags: string[];
};

type DesktopController = {
  bridge: DesktopBridge | null;
  state: ViewState;
  viewerState: ViewerState;
  viewerVideoRef: React.RefObject<HTMLVideoElement | null>;
  viewerReactRootRef: React.RefObject<HTMLDivElement | null>;
  filteredSessions: SessionRecord[];
  setDateFilter: (preset: DatePreset) => void;
  setTagFilter: (tag: string | null) => void;
  setTagFilterDraft: (value: string) => void;
  openSettings: () => void;
  closeSettings: () => void;
  chooseFolder: () => void;
  saveFolder: () => void;
  openCurrentOutputFolder: () => void;
  openConfigFile: () => void;
  openLocalSession: () => void;
  importZip: () => void;
  viewSession: (sessionId: string) => void;
  openSessionFolder: (sessionId: string) => void;
  exportSessionZip: (sessionId: string) => void;
  deleteSessionClick: (sessionId: string) => void;
  startTagEdit: (sessionId: string) => void;
  cancelTagEdit: () => void;
  setInlineTagDraft: (value: string) => void;
  addTagToSession: (sessionId: string, tag: string) => void;
  removeTagFromSession: (sessionId: string, tag: string) => void;
  closeViewer: () => void;
  setViewerNotesValue: (value: string) => void;
  saveViewerNotes: () => void;
  copyViewerValue: (value: string, label: string) => void;
  setViewerSection: (section: TimelineSection) => void;
  setViewerSubtype: (value: ViewerState["networkSubtypeFilter"]) => void;
  setViewerSearch: (value: string) => void;
  clickTimelineItem: (itemId: string, offsetMs: number, event: React.MouseEvent<HTMLButtonElement>) => void;
  openTimelineContext: (itemId: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  focusViewerTimeline: () => void;
  closeNetworkDetail: () => void;
  updateTimelineHighlight: () => void;
  handleViewerVideoError: () => void;
  setMergeValue: (value: string) => void;
  submitMergeDialog: () => void;
  closeMergeDialog: () => void;
};

const runtimePollIntervalMs = 2_000;
const mediaEventNames = [
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
] as const;

const DesktopContext = createContext<DesktopController | null>(null);

function initialViewState(): ViewState {
  return {
    bridgeError: null,
    config: null,
    runtime: null,
    sessions: [],
    allTags: [],
    dateFilter: "all",
    tagFilter: null,
    editingTagSessionId: null,
    tagInputValue: "",
    pendingDeleteId: null,
    draftOutputDir: "",
    feedback: { text: "Loading desktop companion status…", tone: "neutral" },
    isChoosingFolder: false,
    isLoading: true,
    isSaving: false
  };
}

function useDesktop(): DesktopController {
  const controller = useContext(DesktopContext);
  if (!controller) throw new Error("Desktop context was not initialized.");
  return controller;
}

function cloneViewerState(state: ViewerState): ViewerState {
  return {
    ...state,
    timeline: [...state.timeline],
    pendingMergeActionIds: [...state.pendingMergeActionIds],
    selectedActionIds: new Set(state.selectedActionIds),
    mergeGroups: [...state.mergeGroups]
  };
}

function DesktopAppLayout(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const controller = useDesktopController(navigate, location.pathname);

  return (
    <DesktopContext.Provider value={controller}>
      <div className="app-shell">
        <DesktopTopBar />
        <Outlet />
        <DesktopViewerOverlay />
      </div>
    </DesktopContext.Provider>
  );
}

function DesktopTopBar(): React.JSX.Element {
  const desktop = useDesktop();
  const status = desktop.state.runtime?.status ?? "starting";

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <span className="app-name">Jittle Lamp</span>
        <nav className="page-tabs" aria-label="Desktop pages">
          <NavLink className="page-tab" to="/" end>
            Library
          </NavLink>
          <NavLink className="page-tab" to="/settings">
            Settings
          </NavLink>
        </nav>
      </div>
      <div className="top-bar-right">
        <span className="status-pill" data-status={status}>{formatRuntimeLabel(status)}</span>
        <span className="output-path">{desktop.state.runtime?.outputDir ?? desktop.state.config?.outputDir ?? "—"}</span>
        <button className="open-local-btn" type="button" onClick={desktop.openLocalSession}>
          Open Local…
        </button>
        <button className="import-zip-btn" type="button" onClick={desktop.importZip}>
          Import ZIP…
        </button>
        <button className="gear-btn" type="button" aria-label="Settings" onClick={desktop.openSettings}>
          ⚙
        </button>
      </div>
    </div>
  );
}

function LibraryPage(): React.JSX.Element {
  const desktop = useDesktop();

  return (
    <main className="desktop-page library-page">
      <div className="filter-bar">
        <div className="date-toggles">
          {(["today", "week", "month", "all"] as const).map((preset) => (
            <button
              key={preset}
              className="date-toggle"
              type="button"
              data-active={desktop.state.dateFilter === preset ? "true" : "false"}
              onClick={() => desktop.setDateFilter(preset)}
            >
              {preset === "all" ? "All" : preset[0]!.toUpperCase() + preset.slice(1)}
            </button>
          ))}
        </div>
        <TagFilter />
        <span className="results-count">
          {desktop.filteredSessions.length} session{desktop.filteredSessions.length === 1 ? "" : "s"}
        </span>
      </div>

      <FeedbackBanner />

      <div className="sessions-scroll">
        {desktop.filteredSessions.length === 0 ? (
          <div className="empty-state">
            <span>No sessions found.</span>
            <span className="empty-hint">Start a browser recording with the extension to populate this list.</span>
          </div>
        ) : (
          desktop.filteredSessions.map((session) => <SessionCard key={session.sessionId} session={session} />)
        )}
      </div>
    </main>
  );
}

function TagFilter(): React.JSX.Element {
  const desktop = useDesktop();
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim().toLowerCase();
  const matches = trimmed ? desktop.state.allTags.filter((tag) => tag.toLowerCase().includes(trimmed)) : [];

  if (desktop.state.tagFilter !== null) {
    return (
      <div className="tag-filter">
        <span className="active-tag-chip">
          {desktop.state.tagFilter}
          <button className="tag-chip-remove" type="button" aria-label="Remove tag filter" onClick={() => desktop.setTagFilter(null)}>
            ✕
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="tag-filter">
      <input
        className="tag-filter-input"
        type="text"
        placeholder="Filter by tag…"
        value={draft}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          desktop.setTagFilterDraft(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft("");
            desktop.setTagFilterDraft("");
          }
        }}
        autoComplete="off"
      />
      {matches.length > 0 ? (
        <div className="tag-autocomplete">
          {matches.map((tag) => (
            <button key={tag} className="tag-option" type="button" onClick={() => desktop.setTagFilter(tag)}>
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FeedbackBanner(): React.JSX.Element {
  const { state } = useDesktop();
  return (
    <div className="feedback-banner" data-tone={state.feedback.tone}>
      {state.feedback.text}
    </div>
  );
}

function SessionCard(props: { session: SessionRecord }): React.JSX.Element {
  const desktop = useDesktop();
  const session = props.session;
  const shortId = session.sessionId.length > 24
    ? `${session.sessionId.slice(0, 10)}…${session.sessionId.slice(-8)}`
    : session.sessionId;
  const hasWebm = session.artifacts.some((artifact) => artifact.artifactName === "recording.webm");
  const hasJson = session.artifacts.some((artifact) => artifact.artifactName === "session.archive.json");
  const isPending = desktop.state.pendingDeleteId === session.sessionId;
  const isEditing = desktop.state.editingTagSessionId === session.sessionId;
  const inlineDraft = desktop.state.tagInputValue.trim().toLowerCase();
  const inlineMatches = inlineDraft
    ? desktop.state.allTags.filter((tag) => !session.tags.includes(tag) && tag.toLowerCase().includes(inlineDraft))
    : [];

  return (
    <article className="session-card">
      <div className="session-head">
        <span className="session-id" title={session.sessionId}>{shortId}</span>
        <span className="session-time">{formatRelativeTime(session.recordedAt)}</span>
      </div>
      <div className="session-artifacts">
        <span className={`artifact-tag ${hasWebm ? "artifact-present" : "artifact-missing"}`}>webm</span>
        <span className={`artifact-tag ${hasJson ? "artifact-present" : "artifact-missing"}`}>json</span>
        <span className="session-size">{formatBytes(session.totalBytes)}</span>
      </div>
      <div className="session-tags">
        {session.tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            <button
              className="tag-chip-x"
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => desktop.removeTagFromSession(session.sessionId, tag)}
            >
              ✕
            </button>
          </span>
        ))}
        {isEditing ? (
          <div className="tag-editor-wrap">
            <input
              className="tag-input-inline"
              type="text"
              value={desktop.state.tagInputValue}
              placeholder="tag name"
              autoFocus
              autoComplete="off"
              onChange={(event) => desktop.setInlineTagDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.currentTarget.value.trim()) {
                  desktop.addTagToSession(session.sessionId, event.currentTarget.value);
                } else if (event.key === "Escape") {
                  desktop.cancelTagEdit();
                }
              }}
            />
            {inlineMatches.length > 0 ? (
              <div className="tag-autocomplete">
                {inlineMatches.map((tag) => (
                  <button key={tag} className="tag-option" type="button" onClick={() => desktop.addTagToSession(session.sessionId, tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <button className="tag-add-btn" type="button" onClick={() => desktop.startTagEdit(session.sessionId)}>
            + tag
          </button>
        )}
      </div>
      <p className="session-path">{session.sessionFolder}</p>
      <div className="session-actions">
        <button className="button ghost sm" type="button" onClick={() => desktop.viewSession(session.sessionId)}>View</button>
        <button className="button ghost sm" type="button" onClick={() => desktop.openSessionFolder(session.sessionId)}>Open</button>
        <button className="button ghost sm" type="button" onClick={() => desktop.exportSessionZip(session.sessionId)}>ZIP</button>
        <button
          className={`button ghost sm${isPending ? " session-delete-confirm" : ""}`}
          type="button"
          onClick={() => desktop.deleteSessionClick(session.sessionId)}
        >
          {isPending ? "Confirm?" : "Delete"}
        </button>
      </div>
    </article>
  );
}

function SettingsPage(): React.JSX.Element {
  const desktop = useDesktop();
  const config = desktop.state.config;
  const isEnvOverrideActive = config?.envOverrideActive ?? false;
  const isDirty = Boolean(config && desktop.state.draftOutputDir !== config.outputDir);
  const hasBridgeError = desktop.state.bridgeError !== null;

  return (
    <main className="desktop-page settings-page">
      <div className="settings-drawer settings-panel" data-open="true">
        <div className="drawer-header">
          <span className="drawer-title">Settings</span>
          <button className="drawer-close" type="button" aria-label="Back to library" onClick={desktop.closeSettings}>
            ✕
          </button>
        </div>
        <div className="drawer-content">
          <div className="drawer-section">
            <span className="drawer-section-label">Output folder</span>
            <div className="drawer-path-display">{config?.outputDir ?? desktop.state.runtime?.outputDir ?? "—"}</div>
            <p className="drawer-effective-summary">
              {config
                ? isEnvOverrideActive
                  ? "Environment override is active — the desktop route is locked until that variable is removed."
                  : "The extension will use this folder whenever the local companion is online."
                : "Reading the current output folder…"}
            </p>
            {isEnvOverrideActive ? (
              <div className="env-override-warning">
                JITTLE_LAMP_OUTPUT_DIR is active and overrides the saved setting.
              </div>
            ) : null}
            <input className="path-input" type="text" value={desktop.state.draftOutputDir} readOnly />
            <div className="drawer-action-row">
              <button
                className="button primary sm"
                type="button"
                disabled={hasBridgeError || desktop.state.isLoading || desktop.state.isChoosingFolder || desktop.state.isSaving || isEnvOverrideActive}
                onClick={desktop.chooseFolder}
              >
                {desktop.state.isChoosingFolder ? "Choosing…" : "Choose folder…"}
              </button>
              <button
                className="button secondary sm"
                type="button"
                disabled={hasBridgeError || desktop.state.isLoading || desktop.state.isSaving || !isDirty || isEnvOverrideActive}
                onClick={desktop.saveFolder}
              >
                {desktop.state.isSaving ? "Saving…" : "Save route"}
              </button>
            </div>
            <div className="drawer-action-row">
              <button className="button ghost sm" type="button" disabled={hasBridgeError || desktop.state.isLoading || !config} onClick={desktop.openCurrentOutputFolder}>
                Open folder
              </button>
              <button className="button ghost sm" type="button" disabled={hasBridgeError || desktop.state.isLoading || !config} onClick={desktop.openConfigFile}>
                Open config
              </button>
            </div>
          </div>

          <div className="drawer-section">
            <span className="drawer-section-label">Route details</span>
            <div className="drawer-detail-grid">
              <DetailItem label="Source" value={config ? formatSourceLabel(config.source) : "—"} />
              <DetailItem label="Saved file" value={config?.savedOutputDir ?? "No saved override"} />
              <DetailItem label="Default folder" value={config?.defaultOutputDir ?? "—"} />
              <DetailItem label="Config file" value={config?.configFilePath ?? "—"} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function DetailItem(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="drawer-detail-item">
      <span className="drawer-detail-label">{props.label}</span>
      <span className="drawer-detail-value">{props.value}</span>
    </div>
  );
}

function DesktopViewerOverlay(): React.JSX.Element {
  const desktop = useDesktop();
  const payload = desktop.viewerState.payload;
  const readOnlyNotice = payload ? createDesktopNotesAdapter().getReadOnlyNotice(payload.source) : null;
  const isReadOnly = payload ? !createDesktopNotesAdapter().canEdit(payload.source) : false;
  const detailItem =
    desktop.viewerState.networkDetailIndex === null
      ? null
      : desktop.viewerState.timeline[desktop.viewerState.networkDetailIndex] ?? null;
  const sectionItems = payload
    ? deriveSectionTimeline(
      payload.archive,
      desktop.viewerState.activeSection,
      desktop.viewerState.networkSubtypeFilter,
      desktop.viewerState.networkSearchQuery
    )
    : [];
  const activeItem = desktop.viewerState.activeIndex >= 0 ? sectionItems[desktop.viewerState.activeIndex] : null;
  const activeItemId = activeItem
    ? desktop.viewerState.activeSection === "actions"
      ? desktop.viewerState.mergeGroups.find((group) => group.memberIds.includes(activeItem.id))?.id ?? activeItem.id
      : activeItem.id
    : null;

  if (!desktop.viewerState.open || !payload) {
    return <div className="viewer-overlay" data-open="false" />;
  }

  return (
    <div
      className="viewer-overlay"
      data-open="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) desktop.closeViewer();
      }}
    >
      <div className="viewer-modal">
        <div className="viewer-header">
          <div className="viewer-header-left">
            <span className="viewer-title">{payload.archive.name}</span>
            <span className="viewer-source-badge" data-source={payload.source}>{getViewerSourceLabel(payload.source)}</span>
          </div>
          <button className="viewer-close" type="button" aria-label="Close viewer" onClick={desktop.closeViewer}>
            ✕
          </button>
        </div>
        <div className="viewer-body">
          <div className="viewer-left">
            <div className="viewer-video-wrap">
              <video
                className="viewer-video"
                ref={desktop.viewerVideoRef}
                controls
                onTimeUpdate={desktop.updateTimelineHighlight}
                onError={desktop.handleViewerVideoError}
              />
            </div>
            <div className="viewer-notes-section">
              <span className="viewer-notes-label">Session notes</span>
              {readOnlyNotice ? <div className="viewer-zip-notice">{readOnlyNotice}</div> : null}
              <textarea
                className="viewer-notes-textarea"
                placeholder="Add notes…"
                value={desktop.viewerState.notesValue}
                readOnly={isReadOnly}
                onChange={(event) => desktop.setViewerNotesValue(event.currentTarget.value)}
              />
              {!isReadOnly ? (
                <div className="viewer-notes-actions">
                  <button
                    className="button sm primary"
                    type="button"
                    disabled={!desktop.viewerState.notesDirty || desktop.viewerState.notesSaving}
                    onClick={desktop.saveViewerNotes}
                  >
                    {desktop.viewerState.notesSaving ? "Saving…" : "Save notes"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div ref={desktop.viewerReactRootRef}>
            <ViewerPane
              activeSection={desktop.viewerState.activeSection}
              networkSearchQuery={desktop.viewerState.networkSearchQuery}
              networkSubtypeFilter={desktop.viewerState.networkSubtypeFilter}
              timelineRows={buildTimelineRows(desktop.viewerState)}
              activeItemId={activeItemId}
              autoFollow={desktop.viewerState.autoFollow}
              focusVisible={!desktop.viewerState.autoFollow}
              networkDetail={detailItem}
              mergeDialog={{
                open: desktop.viewerState.mergeDialogOpen,
                value: desktop.viewerState.mergeDialogValue,
                error: desktop.viewerState.mergeDialogError
              }}
              onSectionChange={desktop.setViewerSection}
              onSubtypeChange={desktop.setViewerSubtype}
              onSearchChange={desktop.setViewerSearch}
              onTimelineClick={desktop.clickTimelineItem}
              onTimelineContext={desktop.openTimelineContext}
              onFocus={desktop.focusViewerTimeline}
              onCloseDetail={desktop.closeNetworkDetail}
              onCopy={desktop.copyViewerValue}
              onMergeValueChange={desktop.setMergeValue}
              onMergeConfirm={desktop.submitMergeDialog}
              onMergeCancel={desktop.closeMergeDialog}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function useDesktopController(navigate: ReturnType<typeof useNavigate>, pathname: string): DesktopController {
  const bridge = useMemo(() => createDesktopBridge(), []);
  const [state, setState] = useState<ViewState>(() => initialViewState());
  const [viewerState, setViewerState] = useState<ViewerState>(() => createViewerState());
  const stateRef = useRef(state);
  const viewerStateRef = useRef(viewerState);
  const pendingDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);
  const viewerReactRootRef = useRef<HTMLDivElement | null>(null);
  const viewerVideoStateRef = useRef<ViewerVideoState>(createViewerVideoState());
  const contextTargetIdRef = useRef<string | null>(null);
  const hasReportedViewerBootRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
  const storageAdapter = useMemo(() => (bridge ? createDesktopStorageAdapter(bridge) : null), [bridge]);
  const notesAdapter = useMemo(() => createDesktopNotesAdapter(), []);
  const shareAdapter = useMemo(() => createDesktopShareAdapter(), []);
  void shareAdapter;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    viewerStateRef.current = viewerState;
  }, [viewerState]);

  const patchState = (update: Partial<ViewState> | ((previous: ViewState) => ViewState)): void => {
    setState((previous) => (typeof update === "function" ? update(previous) : { ...previous, ...update }));
  };

  const updateViewer = (mutator: (next: ViewerState) => void): void => {
    setViewerState((previous) => {
      const next = cloneViewerState(previous);
      mutator(next);
      return next;
    });
  };

  const filteredSessions = useMemo(
    () => filterSessions({ sessions: state.sessions, tagFilter: state.tagFilter, dateFilter: state.dateFilter }),
    [state.dateFilter, state.sessions, state.tagFilter]
  );

  const getSelectedActionEntryIds = (): string[] => {
    const current = viewerStateRef.current;
    const payload = current.payload;
    return payload ? getContiguousMergeableSelection(payload.archive, current.mergeGroups, current.selectedActionIds) : [];
  };

  const renderViewerPane = (): void => {
    if (!hasReportedViewerBootRef.current) {
      reportDesktopViewerTelemetry({ implementation: "react", phase: "booted" });
      hasReportedViewerBootRef.current = true;
    }
  };

  const persistViewerReviewState = async (successText?: string): Promise<void> => {
    const current = viewerStateRef.current;
    const payload = current.payload;
    if (!payload) return;

    if (!notesAdapter.canEdit(payload.source) || !storageAdapter) {
      if (successText) patchState({ feedback: { tone: "neutral", text: successText } });
      return;
    }

    const response = await storageAdapter.saveSessionReviewState?.({
      sessionId: payload.archive.sessionId,
      notes: current.notesValue,
      annotations: current.mergeGroups
    });
    if (!response) throw new Error("Session review persistence adapter is unavailable.");

    updateViewer((next) => {
      if (!next.payload || next.payload.archive.sessionId !== payload.archive.sessionId) return;
      next.notesDirty = false;
      next.payload = {
        ...next.payload,
        archive: response.archive,
        notes: next.notesValue
      };
      next.timeline = deriveTimeline(response.archive);
      next.mergeGroups = getArchiveMergeGroups(response.archive);
    });

    if (successText) patchState({ feedback: { tone: "success", text: successText } });
  };

  const openViewer = (payload: ViewerPayload): void => {
    const previousPayload = viewerStateRef.current.payload;
    if (previousPayload && shouldClearViewerTempSession(previousPayload) && bridge) {
      const previousTempId = previousPayload.tempId;
      if (previousTempId !== undefined) {
        void bridge.rpc.request.clearTempSession({ tempId: previousTempId }).catch(() => undefined);
      }
    }

    setViewerState(() => {
      const next = createViewerState();
      applyViewerPayload(next, payload);
      return next;
    });
    renderViewerPane();
  };

  const closeViewer = (): void => {
    const payload = viewerStateRef.current.payload;
    const video = viewerVideoRef.current;

    setViewerState((previous) => {
      const next = cloneViewerState(previous);
      resetViewerState(next);
      return next;
    });

    contextTargetIdRef.current = null;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    viewerVideoStateRef.current.loadVersion += 1;
    resetViewerVideoDiagnostics(viewerVideoStateRef.current);

    if (payload && shouldClearViewerTempSession(payload) && bridge) {
      const tempId = payload.tempId;
      if (tempId !== undefined) {
        void bridge.rpc.request.clearTempSession({ tempId }).catch(() => undefined);
      }
    }
  };

  useEffect(() => {
    reportDesktopViewerTelemetry({ implementation: "react", phase: "selected" });
  }, []);

  useEffect(() => {
    if (!bridge) {
      patchState({
        bridgeError: "Electrobun view RPC did not initialize in this renderer.",
        feedback: { tone: "error", text: "Desktop runtime unavailable." },
        isLoading: false
      });
      return;
    }

    const activeBridge = bridge;
    let cancelled = false;

    async function loadInitialData(): Promise<void> {
      try {
        const [config, runtime, sessions, allTags] = await Promise.all([
          activeBridge.rpc.request.getCompanionConfig(undefined),
          activeBridge.rpc.request.getCompanionRuntime(undefined),
          activeBridge.rpc.request.listSessions(undefined).catch((): SessionRecord[] => []),
          activeBridge.rpc.request.listAllTags(undefined).catch((): string[] => [])
        ]);

        if (cancelled) return;
        patchState({
          config,
          runtime,
          sessions,
          allTags,
          draftOutputDir: config.outputDir,
          feedback: {
            tone: runtime.status === "error" ? "error" : "neutral",
            text:
              runtime.status === "error"
                ? runtime.lastError ?? "The desktop companion failed to start."
                : config.envOverrideActive
                  ? "JITTLE_LAMP_OUTPUT_DIR is currently overriding the saved desktop setting."
                  : "Choose a folder, save it, and keep this app open while recording."
          },
          isLoading: false
        });
      } catch (error) {
        if (cancelled) return;
        patchState({
          feedback: {
            tone: "error",
            text: formatErrorMessage(error, "Unable to load desktop companion state.")
          },
          isLoading: false
        });
      }
    }

    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;

    const interval = setInterval(() => {
      void (async () => {
        try {
          const [runtime, sessions, allTags] = await Promise.all([
            bridge.rpc.request.getCompanionRuntime(undefined),
            bridge.rpc.request.listSessions(undefined).catch((): SessionRecord[] => stateRef.current.sessions),
            bridge.rpc.request.listAllTags(undefined).catch((): string[] => stateRef.current.allTags)
          ]);

          patchState((previous) => ({
            ...previous,
            runtime,
            sessions,
            allTags,
            feedback:
              runtime.status === "error"
                ? {
                  tone: "error",
                  text: runtime.lastError ?? "The desktop companion runtime is reporting an error."
                }
                : previous.feedback.tone !== "success" && !previous.isSaving && !previous.isChoosingFolder
                  ? {
                    tone: "neutral",
                    text:
                      runtime.status === "listening"
                        ? "Desktop companion is listening locally. Extension exports should land here without browser download prompts."
                        : "Waiting for the desktop companion runtime."
                  }
                  : previous.feedback
          }));
        } catch (error) {
          patchState({
            feedback: {
              tone: "error",
              text: formatErrorMessage(error, "Unable to refresh the companion runtime.")
            }
          });
        }
      })();
    }, runtimePollIntervalMs);

    return () => clearInterval(interval);
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    bridge.onContextMenuClicked(({ action }) => {
      if (action === "merge") {
        const selectedActionIds = getSelectedActionEntryIds();
        if (selectedActionIds.length < 2) {
          patchState({ feedback: { tone: "error", text: "Select at least two actions before merging." } });
          return;
        }
        updateViewer((next) => openMergeDialogState(next, selectedActionIds));
      } else if (action === "unmerge") {
        const targetId = contextTargetIdRef.current;
        contextTargetIdRef.current = null;
        if (!targetId) return;
        updateViewer((next) => {
          next.mergeGroups = next.mergeGroups.filter((group) => group.id !== targetId);
          next.selectedActionIds = new Set();
        });
        void persistViewerReviewState("Merge removed.");
      }
    });
  }, [bridge]);

  useEffect(() => {
    const video = viewerVideoRef.current;
    if (!video) return;

    const handlers = mediaEventNames.map((eventName) => {
      const handler = (): void => recordViewerVideoEvent(video, viewerVideoStateRef.current, eventName);
      video.addEventListener(eventName, handler);
      return { eventName, handler };
    });

    return () => {
      for (const { eventName, handler } of handlers) {
        video.removeEventListener(eventName, handler);
      }
    };
  }, [viewerState.open]);

  useEffect(() => {
    const payload = viewerState.payload;
    const video = viewerVideoRef.current;
    if (!payload || !viewerState.open || !video) return;

    const recordingArtifact = payload.archive.artifacts.find((artifact) => artifact.kind === "recording.webm");
    void loadViewerVideoSource({
      videoPath: payload.videoPath,
      mimeType: recordingArtifact?.mimeType || "video/webm",
      viewerVideo: video,
      viewerVideoState: viewerVideoStateRef.current,
      desktopBridge: bridge,
      getViewerSource: () => viewerStateRef.current.payload?.source ?? "unknown",
      isViewerOpen: () => viewerStateRef.current.open,
      onBridgeUnavailable: () => {
        patchState({ feedback: { tone: "error", text: "Desktop bridge unavailable for evidence video loading." } });
      },
      onLoadFailure: (error, diagnostics) => {
        console.warn(formatErrorMessage(error, "Unable to load the evidence video through desktop RPC."), diagnostics);
      }
    });
  }, [bridge, viewerState.open, viewerState.payload?.videoPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        if (viewerStateRef.current.mergeDialogOpen) {
          updateViewer((next) => closeMergeDialogState(next));
        } else if (viewerStateRef.current.open) {
          closeViewer();
        } else if (pathname === "/settings") {
          navigate("/");
        } else if (stateRef.current.editingTagSessionId !== null) {
          patchState({ editingTagSessionId: null, tagInputValue: "" });
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "q") {
        event.preventDefault();
        if (bridge) void bridge.rpc.request.exitApp(undefined);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [bridge, navigate, pathname]);

  return {
    bridge,
    state,
    viewerState,
    viewerVideoRef,
    viewerReactRootRef,
    filteredSessions,
    setDateFilter: (preset) => patchState({ dateFilter: preset }),
    setTagFilter: (tag) => patchState({ tagFilter: tag }),
    setTagFilterDraft: () => undefined,
    openSettings: () => navigate("/settings"),
    closeSettings: () => navigate("/"),
    chooseFolder: () => {
      void (async () => {
        const current = stateRef.current;
        if (!bridge || !current.config || current.config.envOverrideActive) return;
        patchState({
          isChoosingFolder: true,
          feedback: { tone: "neutral", text: "Waiting for a local folder selection…" }
        });
        try {
          const { selectedPath } = await bridge.rpc.request.chooseOutputDirectory({
            startingFolder: current.draftOutputDir || current.config.outputDir
          });
          patchState({
            draftOutputDir: selectedPath ?? stateRef.current.draftOutputDir,
            feedback: selectedPath
              ? { tone: "neutral", text: "Folder selected. Save route to switch the running companion." }
              : { tone: "neutral", text: "Folder selection cancelled." }
          });
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Unable to open the native folder picker.") } });
        } finally {
          patchState({ isChoosingFolder: false });
        }
      })();
    },
    saveFolder: () => {
      void (async () => {
        const current = stateRef.current;
        if (!bridge || !current.config || current.config.envOverrideActive) return;
        patchState({
          isSaving: true,
          feedback: { tone: "neutral", text: "Saving folder route and refreshing the running companion…" }
        });
        try {
          const nextConfig = await bridge.rpc.request.saveOutputDirectory({ outputDir: current.draftOutputDir });
          const nextRuntime = await bridge.rpc.request.getCompanionRuntime(undefined);
          patchState({
            config: nextConfig,
            runtime: nextRuntime,
            draftOutputDir: nextConfig.outputDir,
            feedback: { tone: "success", text: "Saved. New extension exports will use this folder immediately." }
          });
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Unable to save the output folder.") } });
        } finally {
          patchState({ isSaving: false });
        }
      })();
    },
    openCurrentOutputFolder: () => {
      const current = stateRef.current;
      if (!bridge || !current.config) return;
      void bridge.rpc.request.openPath({ path: current.config.outputDir });
    },
    openConfigFile: () => {
      const current = stateRef.current;
      if (!bridge || !current.config) return;
      void bridge.rpc.request.openPath({ path: current.config.configFilePath });
    },
    openLocalSession: () => {
      void (async () => {
        if (!bridge || viewerStateRef.current.isOpening) return;
        updateViewer((next) => {
          next.isOpening = true;
        });
        patchState({ feedback: { tone: "neutral", text: "Opening local session folder…" } });
        try {
          const payload = await storageAdapter?.openLocalSession?.();
          if (!payload) throw new Error("Local session adapter is unavailable.");
          openViewer(payload);
          patchState({ feedback: { tone: "neutral", text: "Local session loaded." } });
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Failed to open local session.") } });
        } finally {
          updateViewer((next) => {
            next.isOpening = false;
          });
        }
      })();
    },
    importZip: () => {
      void (async () => {
        if (!bridge || viewerStateRef.current.isOpening) return;
        updateViewer((next) => {
          next.isOpening = true;
        });
        patchState({ feedback: { tone: "neutral", text: "Opening ZIP file picker…" } });
        try {
          const payload = await storageAdapter?.importZipSession?.();
          if (!payload) throw new Error("ZIP import adapter is unavailable.");
          openViewer(payload);
          patchState({ feedback: { tone: "neutral", text: "ZIP session loaded." } });
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Failed to import ZIP session.") } });
        } finally {
          updateViewer((next) => {
            next.isOpening = false;
          });
        }
      })();
    },
    viewSession: (sessionId) => {
      void (async () => {
        if (!bridge || viewerStateRef.current.isOpening) return;
        updateViewer((next) => {
          next.isOpening = true;
        });
        patchState({ feedback: { tone: "neutral", text: "Loading session…" } });
        try {
          const payload = await storageAdapter?.loadLibrarySession?.(sessionId);
          if (!payload) throw new Error("Library session adapter is unavailable.");
          openViewer(payload);
          patchState({ feedback: { tone: "neutral", text: "Session loaded." } });
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Failed to load session.") } });
        } finally {
          updateViewer((next) => {
            next.isOpening = false;
          });
        }
      })();
    },
    openSessionFolder: (sessionId) => {
      if (!bridge) return;
      const session = stateRef.current.sessions.find((candidate) => candidate.sessionId === sessionId);
      if (!session) return;
      void bridge.rpc.request.openPath({ path: session.sessionFolder });
    },
    exportSessionZip: (sessionId) => {
      void (async () => {
        if (!bridge) return;
        patchState({ feedback: { tone: "neutral", text: "Exporting session ZIP…" } });
        try {
          const exportResult = await storageAdapter?.exportSessionZip?.(sessionId);
          if (!exportResult) throw new Error("ZIP export adapter is unavailable.");
          patchState({ feedback: { tone: "success", text: `ZIP exported → ${exportResult.savedPath}` } });
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Failed to export session ZIP.") } });
        }
      })();
    },
    deleteSessionClick: (sessionId) => {
      if (stateRef.current.pendingDeleteId === sessionId) {
        if (pendingDeleteTimerRef.current !== null) {
          clearTimeout(pendingDeleteTimerRef.current);
          pendingDeleteTimerRef.current = null;
        }
        patchState({ pendingDeleteId: null });
        void (async () => {
          if (!bridge) return;
          try {
            await bridge.rpc.request.deleteSession({ sessionId });
            patchState((previous) => ({
              ...previous,
              sessions: previous.sessions.filter((session) => session.sessionId !== sessionId),
              feedback: { tone: "success", text: "Session deleted." }
            }));
          } catch (error) {
            patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Failed to delete the session.") } });
          }
        })();
        return;
      }

      if (pendingDeleteTimerRef.current !== null) clearTimeout(pendingDeleteTimerRef.current);
      patchState({ pendingDeleteId: sessionId });
      pendingDeleteTimerRef.current = setTimeout(() => {
        patchState({ pendingDeleteId: null });
        pendingDeleteTimerRef.current = null;
      }, 3_000);
    },
    startTagEdit: (sessionId) => patchState({ editingTagSessionId: sessionId, tagInputValue: "" }),
    cancelTagEdit: () => patchState({ editingTagSessionId: null, tagInputValue: "" }),
    setInlineTagDraft: (value) => patchState({ tagInputValue: value }),
    addTagToSession: (sessionId, tag) => {
      void (async () => {
        if (!bridge) return;
        const trimmed = tag.trim();
        if (!trimmed) return;
        try {
          await bridge.rpc.request.addSessionTag({ sessionId, tag: trimmed });
          const [sessions, allTags] = await Promise.all([
            bridge.rpc.request.listSessions(undefined).catch((): SessionRecord[] => stateRef.current.sessions),
            bridge.rpc.request.listAllTags(undefined).catch((): string[] => stateRef.current.allTags)
          ]);
          patchState({ sessions, allTags });
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Failed to add tag.") } });
        } finally {
          patchState({ editingTagSessionId: null, tagInputValue: "" });
        }
      })();
    },
    removeTagFromSession: (sessionId, tag) => {
      void (async () => {
        if (!bridge) return;
        try {
          await bridge.rpc.request.removeSessionTag({ sessionId, tag });
          const [sessions, allTags] = await Promise.all([
            bridge.rpc.request.listSessions(undefined).catch((): SessionRecord[] => stateRef.current.sessions),
            bridge.rpc.request.listAllTags(undefined).catch((): string[] => stateRef.current.allTags)
          ]);
          patchState({ sessions, allTags });
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Failed to remove tag.") } });
        }
      })();
    },
    closeViewer,
    setViewerNotesValue: (value) => {
      updateViewer((next) => {
        next.notesValue = value;
        next.notesDirty = next.notesValue !== (next.payload?.notes ?? "");
      });
    },
    saveViewerNotes: () => {
      void (async () => {
        updateViewer((next) => {
          next.notesSaving = true;
        });
        try {
          await persistViewerReviewState("Notes saved.");
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, "Failed to save notes.") } });
        } finally {
          updateViewer((next) => {
            next.notesSaving = false;
          });
        }
      })();
    },
    copyViewerValue: (value, label) => {
      void (async () => {
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
          patchState({ feedback: { tone: "success", text: `Copied ${label}.` } });
        } catch (error) {
          patchState({ feedback: { tone: "error", text: formatErrorMessage(error, `Failed to copy ${label}.`) } });
        }
      })();
    },
    setViewerSection: (section) => {
      updateViewer((next) => {
        next.activeSection = section;
        next.networkDetailIndex = null;
      });
    },
    setViewerSubtype: (value) => {
      updateViewer((next) => {
        next.networkSubtypeFilter = value;
        next.networkDetailIndex = null;
      });
    },
    setViewerSearch: (value) => {
      updateViewer((next) => {
        next.networkSearchQuery = value;
        next.networkDetailIndex = null;
      });
    },
    clickTimelineItem: (itemId, offsetMs, event) => {
      const current = viewerStateRef.current;
      const video = viewerVideoRef.current;
      if (video) video.currentTime = Math.max(0, offsetMs / 1000);
      updateViewer((next) => {
        next.autoFollow = false;
        if (next.activeSection === "actions" && next.payload) {
          if (event.metaKey || event.ctrlKey) {
            const selection = toggleActionSelection(
              { selectedActionIds: next.selectedActionIds, anchorActionId: next.anchorActionId },
              itemId
            );
            next.selectedActionIds = selection.selectedActionIds;
            next.anchorActionId = selection.anchorActionId;
          } else if (event.shiftKey && next.anchorActionId) {
            const selection = selectActionRange(
              next.payload.archive,
              next.mergeGroups,
              { selectedActionIds: next.selectedActionIds, anchorActionId: next.anchorActionId },
              itemId
            );
            if (selection.selectedActionIds.size > 0) next.selectedActionIds = selection.selectedActionIds;
          } else {
            const selection = selectSingleAction(itemId);
            next.selectedActionIds = selection.selectedActionIds;
            next.anchorActionId = selection.anchorActionId;
          }
        } else {
          const fullTimelineIndex = current.timeline.findIndex((timelineItem) => timelineItem.id === itemId);
          if (fullTimelineIndex !== -1) {
            const timelineItem = current.timeline[fullTimelineIndex];
            next.networkDetailIndex =
              timelineItem?.kind === "network" && current.networkDetailIndex !== fullTimelineIndex
                ? fullTimelineIndex
                : null;
          }
        }
      });
    },
    openTimelineContext: (itemId, event) => {
      const current = viewerStateRef.current;
      if (current.activeSection !== "actions" || !current.payload || !bridge) return;
      event.preventDefault();
      contextTargetIdRef.current = itemId;
      updateViewer((next) => {
        if (!next.selectedActionIds.has(itemId)) {
          const selection = selectSingleAction(itemId);
          next.selectedActionIds = selection.selectedActionIds;
          next.anchorActionId = selection.anchorActionId;
        }
      });
      const isMerged = Boolean(current.mergeGroups.find((group) => group.id === itemId));
      const selectedActionIds = getSelectedActionEntryIds();
      const canMerge = !isMerged && selectedActionIds.length >= 2;
      const canUnmerge = isMerged;
      if (!canMerge && !canUnmerge) return;
      const menu: import("../rpc").ContextMenuItem[] = [];
      if (canMerge) menu.push({ label: "Merge Actions…", action: "merge" });
      if (canUnmerge) menu.push({ label: "Un-merge", action: "unmerge" });
      void bridge.rpc.request.showContextMenu({ menu });
    },
    focusViewerTimeline: () => {
      updateViewer((next) => {
        next.autoFollow = true;
      });
    },
    closeNetworkDetail: () => {
      updateViewer((next) => {
        next.networkDetailIndex = null;
      });
    },
    updateTimelineHighlight: () => {
      const current = viewerStateRef.current;
      const payload = current.payload;
      const video = viewerVideoRef.current;
      if (!payload || !video) return;
      const items = deriveSectionTimeline(payload.archive, current.activeSection, current.networkSubtypeFilter, current.networkSearchQuery);
      const activeIndex = findActiveIndex(items, video.currentTime * 1000);
      updateViewer((next) => {
        next.activeIndex = activeIndex;
      });
      if (!current.autoFollow || isAutoScrollingRef.current) return;
      isAutoScrollingRef.current = true;
      requestAnimationFrame(() => {
        const activeRow = viewerReactRootRef.current?.querySelector<HTMLElement>(".viewer-timeline .timeline-item[data-active='true']");
        activeRow?.scrollIntoView({ block: "nearest" });
        isAutoScrollingRef.current = false;
      });
    },
    handleViewerVideoError: () => {
      const video = viewerVideoRef.current;
      if (!video) return;
      const diagnostics = collectViewerVideoDiagnostics(video, viewerVideoStateRef.current, "error-event");
      console.error("[jittle-lamp][viewer-video] playback failed", diagnostics);
      patchState({
        feedback: {
          tone: "error",
          text: `Unable to play the evidence video (${diagnostics.error.codeLabel}). Full media diagnostics logged.`
        }
      });
    },
    setMergeValue: (value) => {
      updateViewer((next) => {
        next.mergeDialogValue = value;
        next.mergeDialogError = null;
      });
    },
    submitMergeDialog: () => {
      const validation = validateMergeDialog(viewerStateRef.current);
      if (!validation.ok) {
        updateViewer((next) => {
          next.mergeDialogError = validation.error;
        });
        return;
      }
      const group = createMergeGroup({
        id: `mg-${Date.now()}`,
        createdAt: new Date().toISOString(),
        label: validation.label,
        selectedActionIds: validation.selectedActionIds
      });
      updateViewer((next) => {
        next.mergeGroups = [...next.mergeGroups, group];
        next.selectedActionIds = new Set();
        closeMergeDialogState(next);
      });
      void persistViewerReviewState("Merged actions.");
    },
    closeMergeDialog: () => {
      updateViewer((next) => closeMergeDialogState(next));
    }
  };
}

function buildTimelineRows(viewerState: ViewerState): TimelineRow[] {
  const payload = viewerState.payload;
  if (!payload) return [];

  const section = viewerState.activeSection;
  const items = deriveSectionTimeline(payload.archive, section, viewerState.networkSubtypeFilter, viewerState.networkSearchQuery);

  if (section !== "actions") {
    return items.map((item) => ({
      id: item.id,
      offsetMs: item.offsetMs,
      section,
      label: item.label,
      kind: item.kind,
      selected: false,
      merged: false,
      tags: []
    }));
  }

  const mergedMemberIds = new Set(viewerState.mergeGroups.flatMap((group) => group.memberIds));
  const rows: TimelineRow[] = [];
  const seenGroupIds = new Set<string>();

  for (const item of items) {
    const group = viewerState.mergeGroups.find((candidate) => candidate.memberIds.includes(item.id));
    if (group) {
      if (seenGroupIds.has(group.id)) continue;
      seenGroupIds.add(group.id);
      const memberItems = items.filter((candidate) => group.memberIds.includes(candidate.id));
      const firstMs = Math.min(...memberItems.map((candidate) => candidate.offsetMs));
      const lastMs = Math.max(...memberItems.map((candidate) => candidate.offsetMs));
      rows.push({
        id: group.id,
        offsetMs: firstMs,
        section,
        label: group.label,
        kind: "action",
        selected: viewerState.selectedActionIds.has(group.id),
        merged: true,
        mergedRange: `${formatOffset(firstMs)}–${formatOffset(lastMs)}`,
        tags: group.tags
      });
      continue;
    }
    if (mergedMemberIds.has(item.id)) continue;
    rows.push({
      id: item.id,
      offsetMs: item.offsetMs,
      section,
      label: item.label,
      kind: item.kind,
      selected: viewerState.selectedActionIds.has(item.id),
      merged: false,
      tags: item.tags ?? []
    });
  }

  return rows;
}

const desktopRoutes: JittleRouteObject[] = [
  {
    path: "/",
    element: <DesktopAppLayout />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: "settings", element: <SettingsPage /> }
    ]
  }
];

function DesktopRoutes(): React.JSX.Element {
  const element = useRoutes(desktopRoutes);
  return <>{element}</>;
}

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Desktop main view root element was not found.");

createRoot(root).render(
  <HashRouter>
    <DesktopRoutes />
  </HashRouter>
);
