import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { BrowserRouter, useNavigate, useParams, useRoutes } from "react-router";
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
  type SessionArchive,
  type TimelineItem
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
import {
  ViewerModal,
  buildCurl,
  getResponseBodyString,
  type ViewerContextMenuState,
  type ViewerModalRow
} from "@jittle-lamp/viewer-react";

import { buildReviewedArchive } from "./archive-export";
import { buildReviewedZipBlob, createWebNotesAdapter, createWebPlaybackAdapter, createWebShareAdapter, createWebStorageAdapter } from "./adapters";
import { api, type ArtifactReadUrl, type EvidenceArtifact } from "./api";
import { DesktopAuthApprovalPage } from "./desktop-auth-page";
import { clerkPublishableKey } from "./env";
import { JoinOrganizationPage } from "./join-org-page";
import { loadRemoteSessionArtifacts } from "./loader";
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
  const [contextMenu, setContextMenu] = useState<ViewerContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    rowId: null,
    kind: "actions",
    canMerge: false,
    canUnmerge: false
  });
  const [downloadingZip, setDownloadingZip] = useState(false);
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
      rowId: itemId,
      kind: "actions",
      canMerge: mergeable.length >= 2,
      canUnmerge: Boolean(group)
    });
  };

  const closeContextMenu = (): void => {
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
  };

  const handleContextMenuMerge = (): void => {
    if (!state.archive || !contextMenu.rowId) return;
    const selectedIds = state.selectedActionIds.has(contextMenu.rowId)
      ? state.selectedActionIds
      : new Set([contextMenu.rowId]);
    const mergeable = getContiguousMergeableSelection(state.archive, state.mergeGroups, selectedIds);
    if (mergeable.length < 2) return;
    openMergeDialogState(state, mergeable);
    setState({ ...state });
    closeContextMenu();
  };

  const handleContextMenuUnmerge = (): void => {
    const groupId = contextMenu.rowId;
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
    if (!videoEl || !state.archive) return;

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
    setState((prev) => ({ ...prev, activeIndex: nextActiveIndex }));

    if (state.autoFollow) {
      const tl = timelineRef.current;
      const activeBtn = tl?.querySelector<HTMLElement>("[data-active='true']") ?? null;
      if (activeBtn) {
        autoScrollingRef.current = true;
        activeBtn.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setTimeout(() => {
          autoScrollingRef.current = false;
        }, 300);
      }
    }
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

  const rows: ViewerModalRow[] = sectionItems.map((item) => {
    const isMerged = "mergedRangeText" in item && item.mergedRangeText !== undefined;
    const status = item.payload.kind === "network" ? item.payload.status ?? null : null;
    const subtype = item.kind === "network" ? item.subtype ?? null : null;
    const base: ViewerModalRow = {
      id: item.id,
      offsetMs: item.offsetMs,
      section: state.activeSection,
      label: item.label,
      kind: item.kind,
      selected: state.selectedActionIds.has(item.id),
      merged: Boolean(isMerged),
      tags: item.tags ?? [],
      statusCode: status,
      subtype
    };
    return isMerged && item.mergedRangeText !== undefined
      ? { ...base, mergedRange: item.mergedRangeText }
      : base;
  });

  const drawerItem: TimelineItem | null =
    state.networkDetailIndex !== null ? state.timeline[state.networkDetailIndex] ?? null : null;

  const activeItem = state.activeIndex >= 0 ? sectionItems[state.activeIndex] : null;
  const activeItemId = activeItem ? activeItem.id : null;

  const ensureRecordingBytes = async (): Promise<Uint8Array | null> => {
    if (state.recordingBytes && state.recordingBytes.length > 0) return state.recordingBytes;
    if (!state.videoUrl) return null;
    try {
      const response = await fetch(state.videoUrl);
      if (!response.ok) throw new Error(`Failed to fetch recording (${response.status}).`);
      const buffer = new Uint8Array(await response.arrayBuffer());
      setState((prev) => ({ ...prev, recordingBytes: buffer }));
      return buffer;
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to fetch recording.", "error");
      return null;
    }
  };

  const handleDownloadZip = async (): Promise<void> => {
    if (!state.archive) return;
    setDownloadingZip(true);
    try {
      const bytes = await ensureRecordingBytes();
      if (!bytes) {
        setFeedback("Nothing loaded to export.", "error");
        return;
      }
      const blob = buildReviewedZipBlob({
        archive: state.archive,
        mergeGroups: state.mergeGroups,
        recordingBytes: bytes
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
        archive: prev.archive
          ? buildReviewedArchive({ archive: prev.archive, mergeGroups: prev.mergeGroups })
          : prev.archive,
        feedback: "Updated ZIP exported.",
        feedbackTone: "success"
      }));
    } finally {
      setDownloadingZip(false);
    }
  };

  const shareLinkUrl = shareToken
    ? `${window.location.origin}/share/${encodeURIComponent(shareToken)}`
    : null;

  const onCopy = (value: string, label: string): void => {
    void navigator.clipboard.writeText(value).then(
      () => setFeedback(`Copied ${label}.`, "success"),
      () => setFeedback(`Failed to copy ${label}.`, "error")
    );
  };

  const findNetworkItem = (rowId: string): TimelineItem | null =>
    state.timeline.find((item) => item.id === rowId) ?? null;

  const handleItemClick = (
    row: ViewerModalRow,
    event: React.MouseEvent<HTMLButtonElement>
  ): void => {
    handleTimelineItemClick(event, row.id, row.offsetMs);
    if (state.activeSection === "console") {
      setState((prev) => {
        const idx = prev.timeline.findIndex((item) => item.id === row.id);
        if (idx === -1) return prev;
        return { ...prev, networkDetailIndex: prev.networkDetailIndex === idx ? null : idx };
      });
    }
  };

  return (
    <ViewerModal
      open
      onClose={closeViewer}
      title={state.archive.name}
      tags={[]}
      source={shareToken ? "share" : "zip"}
      isOwner={!shareToken}
      shareLinkUrl={shareLinkUrl}
      {...(shareLinkUrl ? { onCopyShareLink: () => onCopy(shareLinkUrl, "share link") } : {})}
      onDownloadZip={() => void handleDownloadZip()}
      downloadingZip={downloadingZip}
      videoRef={videoRef}
      videoSrc={state.videoUrl}
      notesValue=""
      notesReadOnly
      notesSaving={false}
      notesDirty={false}
      notesNotice="Notes are read-only in web evidence mode."
      onNotesChange={() => undefined}
      onSaveNotes={() => undefined}
      onVideoTimeUpdate={updateHighlight}
      activeSection={state.activeSection}
      onSectionChange={(section) =>
        setState((prev) => ({ ...prev, activeSection: section, activeIndex: -1, networkDetailIndex: null }))
      }
      searchQuery={state.networkSearchQuery}
      onSearchChange={(query) =>
        setState((prev) => ({ ...prev, networkSearchQuery: query, networkDetailIndex: null }))
      }
      subtypeFilter={state.networkSubtypeFilter}
      onSubtypeFilterChange={(subtype) =>
        setState((prev) => ({ ...prev, networkSubtypeFilter: subtype, networkDetailIndex: null }))
      }
      rows={rows}
      activeItemId={activeItemId}
      autoFollow={state.autoFollow}
      onItemClick={handleItemClick}
      onItemContextMenu={(row, event) => {
        if (state.activeSection === "actions") {
          handleTimelineItemContextMenu(event, row.id);
          return;
        }
        if (state.activeSection === "network") {
          setContextMenu({
            open: true,
            x: event.clientX,
            y: event.clientY,
            rowId: row.id,
            kind: "network",
            canMerge: false,
            canUnmerge: false
          });
        }
      }}
      onAutoFollowToggle={() => setState((prev) => ({ ...prev, autoFollow: true }))}
      timelineRef={timelineRef}
      drawerItem={drawerItem}
      onDrawerClose={() => setState((prev) => ({ ...prev, networkDetailIndex: null }))}
      onCopy={onCopy}
      contextMenu={contextMenu}
      onContextMenuClose={closeContextMenu}
      onContextMenuMerge={handleContextMenuMerge}
      onContextMenuUnmerge={handleContextMenuUnmerge}
      onCopyCurl={(rowId) => {
        const item = findNetworkItem(rowId);
        if (item && item.payload.kind === "network") onCopy(buildCurl(item.payload), "cURL command");
      }}
      onCopyResponse={(rowId) => {
        const item = findNetworkItem(rowId);
        if (item && item.payload.kind === "network") onCopy(getResponseBodyString(item.payload), "response body");
      }}
      mergeDialog={{
        open: state.mergeDialogOpen,
        value: state.mergeDialogValue,
        error: state.mergeDialogError
      }}
      onMergeValueChange={(value) =>
        setState((prev) => ({ ...prev, mergeDialogValue: value, mergeDialogError: null }))
      }
      onMergeConfirm={submitMergeDialog}
      onMergeCancel={() => {
        closeMergeDialogState(state);
        setState({ ...state });
      }}
      feedback={state.feedback ? { tone: state.feedbackTone, text: state.feedback } : null}
      onFeedbackDismiss={() => setState((prev) => ({ ...prev, feedback: null }))}
    />
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
  const navigate = useNavigate();
  const orgName = props.orgName ?? "the owner's organization";
  const goToJoin = (): void => {
    const here = window.location.pathname + window.location.search;
    navigate(`/join?redirect=${encodeURIComponent(here)}`);
  };
  return (
    <main className="desktop-auth-page">
      <section className="desktop-auth-panel" aria-live="polite">
        <h1>Evidence is restricted</h1>
        <p>
          This evidence is only available to members of <strong>{orgName}</strong>. Ask an
          owner of {orgName} to invite you, then reload this page.
        </p>
        <div className="join-actions">
          <button className="drop-btn" type="button" onClick={goToJoin}>
            I have the code
          </button>
        </div>
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
  },
  {
    path: "/join",
    element: <JoinOrganizationPage />
  }
];

function EvidenceWebRoutes(): React.JSX.Element {
  const element = useRoutes(evidenceWebRoutes);
  return <>{element}</>;
}
