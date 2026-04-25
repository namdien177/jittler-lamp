import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { BrowserRouter, useParams, useRoutes } from "react-router";
import {
  ClerkDegraded,
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  ClerkProvider,
  SignIn,
  SignedIn,
  SignedOut,
  useAuth
} from "@clerk/clerk-react";
import type { JittleRouteObject } from "@jittle-lamp/viewer-react";
import {
  buildVisibleActionRows,
  buildSectionTimeline,
  findActiveIndex,
  formatOffset,
  type NetworkSubtype,
  type SessionArchive,
  type TimelineSection
} from "@jittle-lamp/shared";
import {
  closeMergeDialog as closeMergeDialogState,
  createMergeGroup,
  createViewerCoreState,
  getContiguousMergeableSelection,
  openMergeDialog as openMergeDialogState,
  reduceViewerPhase,
  resetViewerCoreState,
  selectActionRange,
  selectSingleAction,
  toggleActionSelection,
  validateMergeDialog
} from "@jittle-lamp/viewer-core";

import { buildReviewedArchive } from "./archive-export";
import { buildReviewedZipBlob, createWebNotesAdapter, createWebPlaybackAdapter, createWebShareAdapter, createWebStorageAdapter } from "./adapters";
import { api, type ArtifactReadUrl, type EvidenceArtifact } from "./api";
import { DesktopAuthApprovalPage } from "./desktop-auth-page";
import { clerkPublishableKey } from "./env";
import { loadRemoteSessionArtifacts } from "./loader";
import { NetworkDetail } from "./network-detail";
import { useWebFileAdapter } from "./web-adapter";

export type FeedbackTone = "neutral" | "success" | "error";
export type AppState = ReturnType<typeof createViewerCoreState> & {
  phase: "idle" | "loading" | "error" | "viewing";
  error: string | null;
  archive: SessionArchive | null;
  videoUrl: string | null;
  recordingBytes: Uint8Array | null;
  feedback: string | null;
  feedbackTone: FeedbackTone;
  restrictedOrgName: string | null;
};

type SectionTimelineItem = ReturnType<typeof buildSectionTimeline>[number];
type TimelineListItem = SectionTimelineItem & {
  mergedRangeText?: string;
  rangeStartMs?: number;
  rangeEndMs?: number;
};

const NETWORK_SUBTYPE_OPTIONS: ReadonlyArray<{ value: NetworkSubtype | "all"; label: string; emphasis?: boolean }> = [
  { value: "all", label: "All" },
  { value: "xhr", label: "XHR", emphasis: true },
  { value: "fetch", label: "Fetch", emphasis: true },
  { value: "document", label: "Doc" },
  { value: "script", label: "Script" },
  { value: "image", label: "Img" },
  { value: "font", label: "Font" },
  { value: "media", label: "Media" },
  { value: "websocket", label: "WS" },
  { value: "other", label: "Other" }
];

function initialState(): AppState {
  return {
    ...createViewerCoreState(),
    phase: "idle",
    error: null,
    archive: null,
    videoUrl: null,
    recordingBytes: null,
    feedback: null,
    feedbackTone: "neutral",
    restrictedOrgName: null
  };
}

function EvidenceViewerPage(props: {
  shareToken?: string | undefined;
  auth?: ReturnType<typeof useAuth> | undefined;
}): React.JSX.Element {
  const shareToken = props.shareToken;
  const auth = props.auth;
  const [state, setState] = useState<AppState>(() => initialState());
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    itemId: string | null;
    canMerge: boolean;
    canUnmerge: boolean;
  }>({
    open: false,
    x: 0,
    y: 0,
    itemId: null,
    canMerge: false,
    canUnmerge: false
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const autoScrollingRef = useRef(false);
  const remoteSessionRef = useRef<{
    evidenceId: string;
    orgId: string;
    recordingArtifact: EvidenceArtifact;
    archiveArtifact: EvidenceArtifact;
    videoReadUrl: ArtifactReadUrl;
    archiveReadUrl: ArtifactReadUrl;
  } | null>(null);
  const ACTION_HIGHLIGHT_DELTA_MS = 200;

  const storageAdapter = useMemo(() => createWebStorageAdapter(), []);
  const playbackAdapter = useMemo(() => createWebPlaybackAdapter(), []);
  const notesAdapter = useMemo(() => createWebNotesAdapter(), []);
  const shareAdapter = useMemo(() => createWebShareAdapter(), []);
  void notesAdapter;
  void shareAdapter;

  const setFeedback = (text: string, tone: FeedbackTone): void => {
    setState((prev) => ({ ...prev, feedback: text, feedbackTone: tone }));
  };

  useEffect(() => {
    if (!shareToken) return;
    if (!auth) return;
    if (!auth.isLoaded) return;
    if (!auth.isSignedIn) {
      setState((prev) => ({
        ...prev,
        phase: "error",
        error: "Sign in to view this shared evidence."
      }));
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, phase: "loading", error: null, restrictedOrgName: null }));
    void (async () => {
      try {
        const resolved = await api.resolveShareLink(auth.getToken, shareToken);
        if (cancelled) return;
        if (resolved.shareLink.access === "denied") {
          setState((prev) => ({
            ...prev,
            phase: "idle",
            error: null,
            restrictedOrgName: resolved.organization.name
          }));
          return;
        }
        const artifactResult = await api.listEvidenceArtifacts(
          auth.getToken,
          resolved.shareLink.evidenceId,
          resolved.shareLink.orgId
        );
        const recordingArtifact = artifactResult.artifacts.find((artifact) => artifact.kind === "recording");
        const archiveArtifact = artifactResult.artifacts.find((artifact) => artifact.kind === "network-log");
        if (!recordingArtifact || !archiveArtifact) {
          throw new Error("Shared evidence is missing recording or archive artifacts.");
        }

        const [videoReadUrl, archiveReadUrl] = await Promise.all([
          api.createArtifactReadUrl(auth.getToken, resolved.shareLink.evidenceId, recordingArtifact.id, resolved.shareLink.orgId),
          api.createArtifactReadUrl(auth.getToken, resolved.shareLink.evidenceId, archiveArtifact.id, resolved.shareLink.orgId)
        ]);
        const loaded = await loadRemoteSessionArtifacts({
          archiveUrl: archiveReadUrl.url,
          videoUrl: videoReadUrl.url
        });
        if (cancelled) return;
        remoteSessionRef.current = {
          evidenceId: resolved.shareLink.evidenceId,
          orgId: resolved.shareLink.orgId,
          recordingArtifact,
          archiveArtifact,
          videoReadUrl,
          archiveReadUrl
        };
        setState((prev) => ({
          ...prev,
          archive: loaded.archive,
          videoUrl: loaded.videoUrl,
          recordingBytes: null,
          timeline: loaded.timeline,
          activeIndex: -1,
          networkDetailIndex: null,
          networkSearchQuery: "",
          activeSection: "actions",
          networkSubtypeFilter: "all",
          autoFollow: true,
          selectedActionIds: new Set(),
          anchorActionId: null,
          mergeGroups: loaded.mergeGroups,
          phase: "viewing",
          error: null,
          feedback: null
        }));
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, phase: "error", error: message }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shareToken, auth]);

  useEffect(() => {
    if (!shareToken || state.phase !== "viewing") return;
    const remote = remoteSessionRef.current;
    if (!remote || !auth?.isSignedIn) return;

    let cancelled = false;
    const renew = async (): Promise<void> => {
      const current = remoteSessionRef.current;
      if (!current || cancelled) return;
      try {
        const [videoReadUrl, archiveReadUrl] = await Promise.all([
          api.createArtifactReadUrl(auth.getToken, current.evidenceId, current.recordingArtifact.id, current.orgId),
          api.createArtifactReadUrl(auth.getToken, current.evidenceId, current.archiveArtifact.id, current.orgId)
        ]);
        if (cancelled) return;
        remoteSessionRef.current = { ...current, videoReadUrl, archiveReadUrl };
        setState((prev) => {
          if (prev.phase !== "viewing" || !videoRef.current) return prev;
          const currentTime = videoRef.current.currentTime;
          const wasPaused = videoRef.current.paused;
          queueMicrotask(() => {
            if (!videoRef.current) return;
            videoRef.current.currentTime = currentTime;
            if (!wasPaused) void videoRef.current.play().catch(() => undefined);
          });
          return { ...prev, videoUrl: videoReadUrl.url };
        });
      } catch {
        setFeedback("Unable to renew signed evidence URLs.", "error");
      }
    };

    const delay = Math.max(30_000, remote.videoReadUrl.renewAfterMs);
    const timer = window.setInterval(() => void renew(), delay);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [shareToken, state.phase, auth]);

  const applyMergeGroup = (validation: ReturnType<typeof validateMergeDialog> & { ok: true }): void => {
    const newGroup = createMergeGroup({
      id: `merge-${Date.now()}`,
      createdAt: new Date().toISOString(),
      label: validation.label,
      selectedActionIds: validation.selectedActionIds
    });

    setState((prev) => {
      const nextGroups = [...prev.mergeGroups, newGroup];
      return {
        ...prev,
        mergeGroups: nextGroups,
        archive: prev.archive ? buildReviewedArchive({ archive: prev.archive, mergeGroups: nextGroups }) : prev.archive,
        selectedActionIds: new Set(),
        anchorActionId: null,
        mergeDialogOpen: false,
        pendingMergeActionIds: []
      };
    });
  };

  const submitMergeDialog = (): void => {
    const validation = validateMergeDialog(state);
    if (!validation.ok) {
      setState((prev) => ({ ...prev, mergeDialogError: validation.error }));
      return;
    }
    applyMergeGroup(validation);
  };

  const handleTimelineItemClick = (event: React.MouseEvent<HTMLButtonElement>, itemId: string, itemOffsetMs: number): void => {
    if (state.activeSection === "actions") {
      if (event.metaKey || event.ctrlKey) {
        const selection = toggleActionSelection(
          { selectedActionIds: state.selectedActionIds, anchorActionId: state.anchorActionId },
          itemId
        );
        setState((prev) => ({ ...prev, selectedActionIds: selection.selectedActionIds, anchorActionId: selection.anchorActionId }));
      } else if (event.shiftKey && state.anchorActionId && state.archive) {
        const selection = selectActionRange(
          state.archive,
          state.mergeGroups,
          { selectedActionIds: state.selectedActionIds, anchorActionId: state.anchorActionId },
          itemId
        );
        setState((prev) => ({ ...prev, selectedActionIds: selection.selectedActionIds }));
      } else {
        const selection = selectSingleAction(itemId);
        setState((prev) => ({ ...prev, selectedActionIds: selection.selectedActionIds, anchorActionId: selection.anchorActionId }));
      }
    } else if (state.activeSection === "network") {
      setState((prev) => {
        const fullTimelineIndex = prev.timeline.findIndex((timelineItem) => timelineItem.id === itemId);
        if (fullTimelineIndex === -1) return prev;

        const timelineItem = prev.timeline[fullTimelineIndex];
        if (!timelineItem || timelineItem.kind !== "network") return prev;

        return {
          ...prev,
          networkDetailIndex: prev.networkDetailIndex === fullTimelineIndex ? null : fullTimelineIndex
        };
      });
    }

    if (videoRef.current) videoRef.current.currentTime = itemOffsetMs / 1000;
  };

  const handleTimelineItemContextMenu = (event: React.MouseEvent<HTMLButtonElement>, itemId: string): void => {
    if (state.activeSection !== "actions") return;

    event.preventDefault();
    const selectedIds = state.selectedActionIds.has(itemId) ? state.selectedActionIds : new Set([itemId]);
    const mergeable = state.archive
      ? getContiguousMergeableSelection(state.archive, state.mergeGroups, selectedIds)
      : [];
    const group = state.mergeGroups.find((candidate) => candidate.id === itemId);

    setContextMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
      itemId,
      canMerge: mergeable.length >= 2,
      canUnmerge: Boolean(group)
    });
  };

  const closeContextMenu = (): void => {
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
  };

  const handleContextMenuMerge = (): void => {
    if (!state.archive || !contextMenu.itemId) return;
    const selectedIds = state.selectedActionIds.has(contextMenu.itemId)
      ? state.selectedActionIds
      : new Set([contextMenu.itemId]);
    const mergeable = getContiguousMergeableSelection(state.archive, state.mergeGroups, selectedIds);
    if (mergeable.length < 2) return;
    openMergeDialogState(state, mergeable);
    setState({ ...state });
    closeContextMenu();
  };

  const handleContextMenuUnmerge = (): void => {
    const groupId = contextMenu.itemId;
    if (!groupId) return;
    setState((prev) => {
      const nextGroups = prev.mergeGroups.filter((group) => group.id !== groupId);
      if (nextGroups.length === prev.mergeGroups.length) {
        return prev;
      }

      const nextSelected = new Set(prev.selectedActionIds);
      nextSelected.delete(groupId);

      return {
        ...prev,
        mergeGroups: nextGroups,
        selectedActionIds: nextSelected,
        anchorActionId: prev.anchorActionId === groupId ? null : prev.anchorActionId,
        archive: prev.archive ? buildReviewedArchive({ archive: prev.archive, mergeGroups: nextGroups }) : prev.archive
      };
    });
    closeContextMenu();
  };

  const handleFile = async (file: File): Promise<void> => {
    setState((prev) => {
      if (prev.phase === "loading") return prev;
      const nextPhase = reduceViewerPhase(prev, { type: "load:start" });
      return { ...prev, phase: nextPhase.phase, error: nextPhase.error };
    });

    try {
      const loaded = await storageAdapter.loadFromZipFile?.(file);
      if (!loaded) throw new Error("Web ZIP storage adapter is unavailable.");
      setState((prev) => {
        if (prev.videoUrl) playbackAdapter.releaseSource?.({ videoPath: prev.videoUrl });
        playbackAdapter.loadSource({ videoPath: loaded.videoUrl, mimeType: "video/webm" });
        return {
          ...prev,
          archive: loaded.archive,
          videoUrl: loaded.videoUrl,
          recordingBytes: loaded.recordingBytes,
          timeline: loaded.timeline,
          activeIndex: -1,
          networkDetailIndex: null,
          networkSearchQuery: "",
          activeSection: "actions",
          networkSubtypeFilter: "all",
          autoFollow: true,
          selectedActionIds: new Set(),
          anchorActionId: null,
          mergeGroups: loaded.mergeGroups,
          phase: "viewing",
          error: null,
          feedback: null
        };
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setState((prev) => {
        const nextPhase = reduceViewerPhase(prev, { type: "load:error", error: errorMessage });
        return { ...prev, phase: nextPhase.phase, error: nextPhase.error };
      });
    }
  };

  const fileAdapter = useWebFileAdapter({ disabled: state.phase === "loading", onFile: handleFile });

  useEffect(() => {
    return () => {
      if (state.videoUrl) playbackAdapter.releaseSource?.({ videoPath: state.videoUrl });
    };
  }, [state.videoUrl]);

  const sectionItems = useMemo<Array<TimelineListItem>>(() => {
    if (!state.archive) return [];

    const baseItems = buildSectionTimeline(
      state.archive,
      state.activeSection,
      state.networkSubtypeFilter,
      state.networkSearchQuery
    );

    if (state.activeSection !== "actions") {
      return baseItems;
    }

    const itemsById = new Map(baseItems.map((item) => [item.id, item]));
    const rows = buildVisibleActionRows(state.archive, state.mergeGroups);

    return rows
      .map((row) => {
        if (row.memberActionIds.length === 1) {
          const item = itemsById.get(row.id);
          return item ? { ...item, rangeStartMs: item.offsetMs, rangeEndMs: item.offsetMs } : undefined;
        }

        const memberItems = row.memberActionIds
          .map((memberId) => itemsById.get(memberId))
          .filter((item): item is NonNullable<typeof item> => item !== undefined);
        const firstItem = memberItems[0];
        const group = state.mergeGroups.find((candidate) => candidate.id === row.id);
        if (!firstItem || !group) return undefined;

        const firstMs = Math.min(...memberItems.map((item) => item.offsetMs));
        const lastMs = Math.max(...memberItems.map((item) => item.offsetMs));

        return {
          ...firstItem,
          id: group.id,
          offsetMs: firstMs,
          label: group.label,
          tags: group.tags,
          mergedRangeText: `${formatOffset(firstMs)}–${formatOffset(lastMs)}`,
          rangeStartMs: firstMs,
          rangeEndMs: lastMs
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== undefined);
  }, [state.archive, state.activeSection, state.networkSubtypeFilter, state.networkSearchQuery, state.mergeGroups]);

  const updateHighlight = (): void => {
    const videoEl = videoRef.current;
    const tl = timelineRef.current;
    if (!videoEl || !tl || !state.archive) return;

    const currentMs = videoEl.currentTime * 1000;
    const items = state.activeSection === "actions"
      ? sectionItems
      : buildSectionTimeline(
        state.archive,
        state.activeSection,
        state.networkSubtypeFilter,
        state.networkSearchQuery
      );
    const nextActiveIndex = findActiveIndex(items, currentMs);
    const actionActiveIds = state.activeSection === "actions"
      ? new Set(
        sectionItems
          .filter((item) => {
            const start = item.rangeStartMs ?? item.offsetMs;
            const end = item.rangeEndMs ?? item.offsetMs;
            return start <= currentMs + ACTION_HIGHLIGHT_DELTA_MS && end >= currentMs - ACTION_HIGHLIGHT_DELTA_MS;
          })
          .map((item) => item.id)
      )
      : new Set<string>();

    setState((prev) => ({ ...prev, activeIndex: nextActiveIndex }));

    const buttons = tl.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item']");
    let activeBtn: HTMLElement | null = null;
    buttons.forEach((btn, idx) => {
      const isActive =
        state.activeSection === "actions"
          ? actionActiveIds.has(btn.dataset.itemId ?? "")
          : idx === nextActiveIndex;
      btn.dataset.active = isActive ? "true" : "false";
      if (isActive) activeBtn = btn;
    });

    if (state.autoFollow && activeBtn) {
      autoScrollingRef.current = true;
      (activeBtn as HTMLElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
      setTimeout(() => {
        autoScrollingRef.current = false;
      }, 300);
    }
  };

  const downloadUpdatedZip = (): void => {
    if (!state.archive || !state.recordingBytes) {
      setFeedback("Nothing loaded to export.", "error");
      return;
    }
    const blob = buildReviewedZipBlob({
      archive: state.archive,
      mergeGroups: state.mergeGroups,
      recordingBytes: state.recordingBytes
    });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `${state.archive.sessionId}-reviewed.zip`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);

    setState((prev) => ({
      ...prev,
      archive: prev.archive ? buildReviewedArchive({ archive: prev.archive, mergeGroups: prev.mergeGroups }) : prev.archive,
      feedback: "Updated ZIP exported.",
      feedbackTone: "success"
    }));
  };

  const closeViewer = (): void => {
    setState((prev) => {
      if (prev.videoUrl) playbackAdapter.releaseSource?.({ videoPath: prev.videoUrl });
      const next = initialState();
      resetViewerCoreState(next);
      return next;
    });
  };

  if (state.restrictedOrgName) {
    return <RestrictedShareScreen orgName={state.restrictedOrgName} />;
  }

  if (state.phase !== "viewing" || !state.archive) {
    if (shareToken && state.phase === "loading") {
      return (
        <main className="desktop-auth-page">
          <section className="desktop-auth-panel" aria-live="polite">
            <h1>Loading shared evidence</h1>
            <p>Validating the share link…</p>
          </section>
        </main>
      );
    }
    if (shareToken && state.phase === "error") {
      return (
        <main className="desktop-auth-page">
          <section className="desktop-auth-panel" aria-live="polite">
            <h1>Unable to load shared evidence</h1>
            <p>{state.error ?? "Unknown error"}</p>
          </section>
        </main>
      );
    }
    return (
      <div className="drop-zone">
        <div
          className="drop-area"
          data-dragover={fileAdapter.isDragOver ? "true" : "false"}
          onDragOver={fileAdapter.onDragOver}
          onDragLeave={fileAdapter.onDragLeave}
          onDrop={fileAdapter.onDrop}
          onClick={fileAdapter.openDialog}
        >
          <div className="drop-icon">⇪</div>
          <p className="drop-title">{state.phase === "loading" ? "Loading…" : "Drop a session ZIP here"}</p>
          <p className="drop-sub">{state.phase === "loading" ? "Extracting and validating…" : "or click to browse"}</p>
          {state.phase === "error" ? <p className="drop-error">{state.error ?? "Unknown error"}</p> : null}
          {state.phase !== "loading" ? (
            <label className="drop-btn">
              <input
                type="file"
                accept=".zip"
                style={{ display: "none" }}
                ref={fileAdapter.inputRef}
                onChange={fileAdapter.onInputChange}
              />
              Browse file
            </label>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="viewer"
      onClick={closeContextMenu}
      onContextMenu={() => {
        if (contextMenu.open) closeContextMenu();
      }}
    >
      <div className="viewer-header">
        <div className="viewer-header-left">
          <span className="viewer-title">{state.archive.name}</span>
          <span className="viewer-meta">{state.archive.page.url}</span>
        </div>
        <div className="viewer-header-right">
          {state.feedback ? <span className={`feedback feedback-${state.feedbackTone}`}>{state.feedback}</span> : null}
          <button className="btn-ghost" type="button" onClick={downloadUpdatedZip}>
            Export Updated ZIP
          </button>
          <button className="btn-ghost" type="button" onClick={closeViewer}>
            Close
          </button>
        </div>
      </div>

      <div className="viewer-body">
        <div className="viewer-left">
          <video ref={videoRef} className="viewer-video" controls src={state.videoUrl ?? ""} onTimeUpdate={updateHighlight} />

          <SectionTabs
            activeSection={state.activeSection}
            onSelect={(section) => setState((prev) => ({ ...prev, activeSection: section, activeIndex: -1, networkDetailIndex: null }))}
          />

          {state.activeSection === "network" ? (
            <NetworkFilterBar
              subtypeFilter={state.networkSubtypeFilter}
              searchQuery={state.networkSearchQuery}
              onSubtypeFilterChange={(subtype) => setState((prev) => ({ ...prev, networkSubtypeFilter: subtype, networkDetailIndex: null }))}
              onSearchChange={(query) => setState((prev) => ({ ...prev, networkSearchQuery: query, networkDetailIndex: null }))}
            />
          ) : null}

          <div
            className="viewer-section-body"
            data-role="viewer-section-body"
            onScroll={() => {
              if (autoScrollingRef.current || !state.autoFollow) return;
              setState((prev) => ({ ...prev, autoFollow: false }));
            }}
          >
            <TimelineList
              timelineRef={timelineRef}
              items={sectionItems}
              activeSection={state.activeSection}
              activeIndex={state.activeIndex}
              selectedActionIds={state.selectedActionIds}
              onItemClick={handleTimelineItemClick}
              onItemContextMenu={handleTimelineItemContextMenu}
            />
            {!state.autoFollow ? (
              <button className="viewer-focus-btn" type="button" onClick={() => setState((prev) => ({ ...prev, autoFollow: true }))}>
                ↓ Focus
              </button>
            ) : null}
          </div>
        </div>

        <div className="viewer-right">
          <NetworkDetail state={state} setFeedback={setFeedback} setState={setState} />
        </div>
      </div>

      <MergeDialog
        open={state.mergeDialogOpen}
        value={state.mergeDialogValue}
        error={state.mergeDialogError}
        onValueChange={(value) => setState((prev) => ({ ...prev, mergeDialogValue: value, mergeDialogError: null }))}
        onCancel={() => {
          closeMergeDialogState(state);
          setState({ ...state });
        }}
        onConfirm={submitMergeDialog}
      />
      <ContextMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        canMerge={contextMenu.canMerge}
        canUnmerge={contextMenu.canUnmerge}
        onMerge={handleContextMenuMerge}
        onUnmerge={handleContextMenuUnmerge}
        onClose={closeContextMenu}
      />
    </div>
  );
}

function SectionTabs(props: {
  activeSection: TimelineSection;
  onSelect: (section: TimelineSection) => void;
}): React.JSX.Element {
  return (
    <div className="viewer-section-tabs" data-role="viewer-section-tabs">
      {(["actions", "console", "network"] as TimelineSection[]).map((section) => (
        <button
          key={section}
          className="section-tab"
          type="button"
          data-active={props.activeSection === section ? "true" : "false"}
          onClick={() => props.onSelect(section)}
        >
          {section[0]!.toUpperCase() + section.slice(1)}
        </button>
      ))}
    </div>
  );
}

function NetworkFilterBar(props: {
  subtypeFilter: NetworkSubtype | "all";
  searchQuery: string;
  onSubtypeFilterChange: (subtype: NetworkSubtype | "all") => void;
  onSearchChange: (query: string) => void;
}): React.JSX.Element {
  return (
    <div className="viewer-network-filter">
      {NETWORK_SUBTYPE_OPTIONS.map((subtype) => (
        <button
          key={subtype.value}
          className={`subtype-filter${subtype.emphasis ? " subtype-emphasis" : ""}`}
          type="button"
          data-active={props.subtypeFilter === subtype.value ? "true" : "false"}
          onClick={() => props.onSubtypeFilterChange(subtype.value)}
        >
          {subtype.label}
        </button>
      ))}
      <input
        className="viewer-network-search"
        type="text"
        value={props.searchQuery}
        placeholder="Search URL, headers, response, or /regex/"
        onChange={(event) => props.onSearchChange(event.currentTarget.value)}
      />
    </div>
  );
}

function TimelineList(props: {
  timelineRef: React.RefObject<HTMLDivElement | null>;
  items: Array<TimelineListItem>;
  activeSection: TimelineSection;
  activeIndex: number;
  selectedActionIds: ReadonlySet<string>;
  onItemClick: (event: React.MouseEvent<HTMLButtonElement>, itemId: string, itemOffsetMs: number) => void;
  onItemContextMenu: (event: React.MouseEvent<HTMLButtonElement>, itemId: string) => void;
}): React.JSX.Element {
  return (
    <div className="viewer-timeline" ref={props.timelineRef}>
      {props.items.map((item, idx) => (
        <button
          key={item.id}
          className={`timeline-item${item.mergedRangeText ? " timeline-item-merged" : ""}`}
          data-role="timeline-item"
          data-item-id={item.id}
          data-index={idx}
          data-offset-ms={item.offsetMs}
          data-section={props.activeSection}
          data-active={idx === props.activeIndex ? "true" : "false"}
          data-selected={props.selectedActionIds.has(item.id) ? "true" : "false"}
          data-merged={item.mergedRangeText ? "true" : undefined}
          type="button"
          onClick={(event) => props.onItemClick(event, item.id, item.offsetMs)}
          onContextMenu={(event) => props.onItemContextMenu(event, item.id)}
        >
          <span className="timeline-offset">{item.mergedRangeText ?? formatOffset(item.offsetMs)}</span>
          {item.mergedRangeText ? <span className="tl-merged-badge">Merged</span> : null}
          <span className="timeline-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function ContextMenu(props: {
  open: boolean;
  x: number;
  y: number;
  canMerge: boolean;
  canUnmerge: boolean;
  onMerge: () => void;
  onUnmerge: () => void;
  onClose: () => void;
}): React.JSX.Element | null {
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div
      className="viewer-context-menu"
      style={{ left: props.x, top: props.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button className="context-menu-item" type="button" onClick={props.onMerge} disabled={!props.canMerge}>
        Merge
      </button>
      {props.canUnmerge ? (
        <button className="context-menu-item" type="button" onClick={props.onUnmerge}>
          Unmerge
        </button>
      ) : null}
    </div>
  );
}

function MergeDialog(props: {
  open: boolean;
  value: string;
  error: string | null;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element | null {
  if (!props.open) return null;

  return (
    <div className="viewer-merge-dialog-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) props.onCancel();
    }}>
      <div className="viewer-merge-dialog" role="dialog" aria-modal="true">
        <div className="viewer-merge-dialog-header">
          <span className="network-detail-title">Merge Actions</span>
        </div>
        <div className="viewer-merge-dialog-body">
          <label className="viewer-merge-dialog-label" htmlFor="viewer-merge-dialog-input">
            Merged action name
          </label>
          <input
            className="viewer-merge-dialog-input"
            id="viewer-merge-dialog-input"
            type="text"
            value={props.value}
            onChange={(event) => props.onValueChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") props.onCancel();
              if (event.key === "Enter") props.onConfirm();
            }}
          />
          {props.error ? <div className="viewer-merge-dialog-error">{props.error}</div> : null}
        </div>
        <div className="viewer-merge-dialog-actions">
          <button className="btn-ghost" type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="btn-ghost" type="button" onClick={props.onConfirm}>
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}

export function bootstrap(): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("Evidence web root element was not found.");
  const app = (
    <>
      <BrowserRouter>
        <EvidenceWebRoutes />
      </BrowserRouter>
      <Analytics />
    </>
  );

  createRoot(root).render(
    clerkPublishableKey ? (
      <ClerkProvider publishableKey={clerkPublishableKey}>{app}</ClerkProvider>
    ) : app
  );
}

function RestrictedShareScreen(props: { orgName: string | null }): React.JSX.Element {
  const orgName = props.orgName ?? "the owner's organization";
  return (
    <main className="desktop-auth-page">
      <section className="desktop-auth-panel" aria-live="polite">
        <h1>Evidence is restricted</h1>
        <p>
          This evidence is only available to members of <strong>{orgName}</strong>. Ask an
          owner of {orgName} to invite you, then reload this page.
        </p>
      </section>
    </main>
  );
}

function SharedEvidenceAuthGate(): React.JSX.Element {
  const currentUrl = window.location.href;
  return (
    <>
      <ClerkFailed>
        <main className="desktop-auth-page">
          <section className="desktop-auth-panel">
            <h1>Unable to load sign-in</h1>
            <p>Check the Clerk publishable key and network access.</p>
          </section>
        </main>
      </ClerkFailed>
      <ClerkDegraded>
        <main className="desktop-auth-page">
          <section className="desktop-auth-panel">
            <h1>Unable to load sign-in</h1>
            <p>Check the Clerk publishable key and network access.</p>
          </section>
        </main>
      </ClerkDegraded>
      <ClerkLoading>
        <main className="desktop-auth-page">
          <section className="desktop-auth-panel">
            <h1>Loading sign-in</h1>
          </section>
        </main>
      </ClerkLoading>
      <ClerkLoaded>
        <SignedOut>
          <main className="desktop-auth-page">
            <SignIn
              routing="hash"
              forceRedirectUrl={currentUrl}
              fallbackRedirectUrl={currentUrl}
              signUpForceRedirectUrl={currentUrl}
              signUpFallbackRedirectUrl={currentUrl}
            />
          </main>
        </SignedOut>
        <SignedIn>
          <SharedEvidenceViewerPage />
        </SignedIn>
      </ClerkLoaded>
    </>
  );
}

function SharedEvidenceViewerPage(): React.JSX.Element {
  const { shareToken } = useParams();
  const auth = useAuth();
  return <EvidenceViewerPage shareToken={shareToken} auth={auth} />;
}

const evidenceWebRoutes: JittleRouteObject[] = [
  {
    path: "/",
    element: <EvidenceViewerPage />
  },
  {
    path: "/share/:shareToken",
    element: clerkPublishableKey ? (
      <SharedEvidenceAuthGate />
    ) : (
      <div className="viewer-empty" role="alert">
        <h2>Clerk is not configured</h2>
        <p>Set CLERK_PUBLISHABLE_KEY before opening shared evidence.</p>
      </div>
    )
  },
  {
    path: "/desktop-auth",
    element: <DesktopAuthApprovalPage />
  }
];

function EvidenceWebRoutes(): React.JSX.Element {
  const element = useRoutes(evidenceWebRoutes);
  return <>{element}</>;
}
