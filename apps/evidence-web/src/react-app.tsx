import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  buildSectionTimeline,
  findActiveIndex,
  formatOffset,
  type NetworkSubtype,
  type SessionArchive,
  type TimelineItem,
  type TimelineSection
} from "@jittle-lamp/shared";
import {
  closeMergeDialog as closeMergeDialogState,
  createMergeGroup,
  createViewerCoreState,
  getContiguousMergeableSelection,
  getArchiveMergeGroups,
  openMergeDialog as openMergeDialogState,
  reduceViewerPhase,
  resetViewerCoreState,
  selectActionRange,
  selectSingleAction,
  toggleActionSelection,
  validateMergeDialog
} from "@jittle-lamp/viewer-core";

import { buildReviewedArchive, buildReviewedSessionZip } from "./archive-export";
import { loadSessionZip } from "./loader";
import { useWebFileAdapter } from "./web-adapter";

type FeedbackTone = "neutral" | "success" | "error";
type AppState = ReturnType<typeof createViewerCoreState> & {
  phase: "idle" | "loading" | "error" | "viewing";
  error: string | null;
  archive: SessionArchive | null;
  videoUrl: string | null;
  recordingBytes: Uint8Array | null;
  feedback: string | null;
  feedbackTone: FeedbackTone;
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
    feedbackTone: "neutral"
  };
}

function App(): React.JSX.Element {
  const [state, setState] = useState<AppState>(() => initialState());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const autoScrollingRef = useRef(false);

  const setFeedback = (text: string, tone: FeedbackTone): void => {
    setState((prev) => ({ ...prev, feedback: text, feedbackTone: tone }));
  };

  const handleFile = async (file: File): Promise<void> => {
    setState((prev) => {
      if (prev.phase === "loading") return prev;
      const nextPhase = reduceViewerPhase(prev, { type: "load:start" });
      return { ...prev, phase: nextPhase.phase, error: nextPhase.error };
    });

    try {
      const loaded = await loadSessionZip(file);
      setState((prev) => {
        if (prev.videoUrl) URL.revokeObjectURL(prev.videoUrl);
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
      if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
    };
  }, [state.videoUrl]);

  const sectionItems = useMemo(
    () => (state.archive ? buildSectionTimeline(state.archive, state.activeSection, state.networkSubtypeFilter, state.networkSearchQuery) : []),
    [state.archive, state.activeSection, state.networkSubtypeFilter, state.networkSearchQuery]
  );

  const updateHighlight = (): void => {
    const videoEl = videoRef.current;
    const tl = timelineRef.current;
    if (!videoEl || !tl || !state.archive) return;
    const items = buildSectionTimeline(state.archive, state.activeSection, state.networkSubtypeFilter, state.networkSearchQuery);
    const nextActiveIndex = findActiveIndex(items, videoEl.currentTime * 1000);
    const activeItem = nextActiveIndex >= 0 ? items[nextActiveIndex] : undefined;
    const activeItemId = (() => {
      if (!activeItem) return null;
      if (state.activeSection !== "actions") return activeItem.id;
      return state.mergeGroups.find((group) => group.memberIds.includes(activeItem.id))?.id ?? activeItem.id;
    })();

    setState((prev) => ({ ...prev, activeIndex: nextActiveIndex }));

    const buttons = tl.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item']");
    let activeBtn: HTMLElement | null = null;
    buttons.forEach((btn, idx) => {
      const isActive = state.activeSection === "actions" ? btn.dataset.itemId === activeItemId : idx === nextActiveIndex;
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

  const getReviewedArchive = (s: AppState): SessionArchive | null => {
    if (!s.archive) return null;
    return buildReviewedArchive({ archive: s.archive, mergeGroups: s.mergeGroups });
  };

  const downloadUpdatedZip = (): void => {
    if (!state.archive || !state.recordingBytes) {
      setFeedback("Nothing loaded to export.", "error");
      return;
    }
    const zipBytes = buildReviewedSessionZip({ archive: state.archive, mergeGroups: state.mergeGroups, recordingBytes: state.recordingBytes });
    const blob = new Blob([Uint8Array.from(zipBytes).buffer], { type: "application/zip" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = `${state.archive.sessionId}-reviewed.zip`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
    const nextArchive = getReviewedArchive(state);
    setState((prev) => ({ ...prev, archive: nextArchive ?? prev.archive, feedback: "Updated ZIP exported.", feedbackTone: "success" }));
  };

  const closeViewer = (): void => {
    setState((prev) => {
      if (prev.videoUrl) URL.revokeObjectURL(prev.videoUrl);
      const next = initialState();
      resetViewerCoreState(next);
      return next;
    });
  };

  if (state.phase !== "viewing" || !state.archive) {
    return (
      <div className="drop-zone">
        <div className="drop-area" data-dragover={fileAdapter.isDragOver ? "true" : "false"} onDragOver={fileAdapter.onDragOver} onDragLeave={fileAdapter.onDragLeave} onDrop={fileAdapter.onDrop} onClick={fileAdapter.openDialog}>
          <div className="drop-icon">⇪</div>
          <p className="drop-title">{state.phase === "loading" ? "Loading…" : "Drop a session ZIP here"}</p>
          <p className="drop-sub">{state.phase === "loading" ? "Extracting and validating…" : "or click to browse"}</p>
          {state.phase === "error" ? <p className="drop-error">{state.error ?? "Unknown error"}</p> : null}
          {state.phase !== "loading" ? (
            <label className="drop-btn">
              <input type="file" accept=".zip" style={{ display: "none" }} ref={fileAdapter.inputRef} onChange={fileAdapter.onInputChange} />Browse file
            </label>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="viewer" onScroll={(event) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-role='viewer-section-body']") || autoScrollingRef.current || !state.autoFollow) return;
      setState((prev) => ({ ...prev, autoFollow: false }));
    }}>
      <div className="viewer-header">
        <div className="viewer-header-left"><span className="viewer-title">{state.archive.name}</span><span className="viewer-meta">{state.archive.page.url}</span></div>
        <div className="viewer-header-right">
          {state.feedback ? <span className={`feedback feedback-${state.feedbackTone}`}>{state.feedback}</span> : null}
          <button className="btn-ghost" type="button" onClick={downloadUpdatedZip}>Export Updated ZIP</button>
          <button className="btn-ghost" type="button" onClick={closeViewer}>Close</button>
        </div>
      </div>
      <div className="viewer-body">
        <div className="viewer-left">
          <video ref={videoRef} className="viewer-video" controls src={state.videoUrl ?? ""} onTimeUpdate={updateHighlight} />
          <div className="viewer-section-tabs" data-role="viewer-section-tabs">
            {(["actions", "console", "network"] as TimelineSection[]).map((section) => <button key={section} className="section-tab" type="button" data-active={state.activeSection === section ? "true" : "false"} onClick={() => setState((prev) => ({ ...prev, activeSection: section, activeIndex: -1, networkDetailIndex: null }))}>{section[0]!.toUpperCase() + section.slice(1)}</button>)}
          </div>
          {state.activeSection === "network" ? <div className="viewer-network-filter">{(["all", "xhr", "fetch", "document", "script", "image", "font", "media", "websocket", "other"] as const).map((s) => <button key={s} className={`subtype-filter${s === "xhr" || s === "fetch" ? " subtype-emphasis" : ""}`} type="button" data-active={state.networkSubtypeFilter === s ? "true" : "false"} onClick={() => setState((prev) => ({ ...prev, networkSubtypeFilter: s as NetworkSubtype | "all", networkDetailIndex: null }))}>{s === "document" ? "Doc" : s === "image" ? "Img" : s === "websocket" ? "WS" : s[0]!.toUpperCase() + s.slice(1)}</button>)}
            <input className="viewer-network-search" type="text" value={state.networkSearchQuery} placeholder="Search URL, headers, response, or /regex/" onChange={(e) => setState((prev) => ({ ...prev, networkSearchQuery: e.currentTarget.value, networkDetailIndex: null }))} />
          </div> : null}
          <div className="viewer-section-body" data-role="viewer-section-body">
            <div className="viewer-timeline" ref={timelineRef}>
              {sectionItems.map((item, idx) => <button key={item.id} className="timeline-item" data-role="timeline-item" data-item-id={item.id} data-index={idx} data-offset-ms={item.offsetMs} data-section={state.activeSection} data-active={idx === state.activeIndex ? "true" : "false"} data-selected={state.selectedActionIds.has(item.id) ? "true" : "false"} type="button" onClick={(event) => {
                if (state.activeSection === "actions") {
                  if (event.metaKey || event.ctrlKey) {
                    const selection = toggleActionSelection({ selectedActionIds: state.selectedActionIds, anchorActionId: state.anchorActionId }, item.id);
                    setState((prev) => ({ ...prev, selectedActionIds: selection.selectedActionIds, anchorActionId: selection.anchorActionId }));
                  } else if (event.shiftKey && state.anchorActionId && state.archive) {
                    const selection = selectActionRange(state.archive, state.mergeGroups, { selectedActionIds: state.selectedActionIds, anchorActionId: state.anchorActionId }, item.id);
                    setState((prev) => ({ ...prev, selectedActionIds: selection.selectedActionIds }));
                  } else {
                    const selection = selectSingleAction(item.id);
                    setState((prev) => ({ ...prev, selectedActionIds: selection.selectedActionIds, anchorActionId: selection.anchorActionId }));
                  }
                } else if (state.activeSection === "network") {
                  setState((prev) => ({ ...prev, networkDetailIndex: prev.networkDetailIndex === idx ? null : idx }));
                }
                if (videoRef.current) videoRef.current.currentTime = item.offsetMs / 1000;
              }} onContextMenu={(event) => {
                if (state.activeSection !== "actions") return;
                event.preventDefault();
                const selectedIds = state.selectedActionIds.has(item.id) ? state.selectedActionIds : new Set([item.id]);
                const mergeable = state.archive ? getContiguousMergeableSelection(state.archive, state.mergeGroups, selectedIds) : [];
                if (mergeable.length >= 2) {
                  openMergeDialogState(state, mergeable);
                  setState({ ...state });
                }
              }}><span className="timeline-offset">{formatOffset(item.offsetMs)}</span><span className="timeline-label">{item.label}</span></button>)}
            </div>
            {!state.autoFollow ? <button className="viewer-focus-btn" onClick={() => setState((prev) => ({ ...prev, autoFollow: true }))}>↓ Focus</button> : null}
          </div>
        </div>
        <div className="viewer-right"><NetworkDetail state={state} setFeedback={setFeedback} setState={setState} /></div>
      </div>

      {state.mergeDialogOpen ? <div className="viewer-merge-dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) { closeMergeDialogState(state); setState({ ...state }); } }}><div className="viewer-merge-dialog" role="dialog" aria-modal="true"><div className="viewer-merge-dialog-header"><span className="network-detail-title">Merge Actions</span></div><div className="viewer-merge-dialog-body"><label className="viewer-merge-dialog-label" htmlFor="viewer-merge-dialog-input">Merged action name</label><input className="viewer-merge-dialog-input" id="viewer-merge-dialog-input" type="text" value={state.mergeDialogValue} onChange={(e) => setState((prev) => ({ ...prev, mergeDialogValue: e.currentTarget.value, mergeDialogError: null }))} onKeyDown={(e) => { if (e.key === "Escape") { closeMergeDialogState(state); setState({ ...state }); } if (e.key === "Enter") { const validation = validateMergeDialog(state); if (!validation.ok) return setState((prev) => ({ ...prev, mergeDialogError: validation.error })); const newGroup = createMergeGroup({ id: `merge-${Date.now()}`, createdAt: new Date().toISOString(), label: validation.label, selectedActionIds: validation.selectedActionIds }); const nextGroups = [...state.mergeGroups, newGroup]; setState((prev) => ({ ...prev, mergeGroups: nextGroups, archive: prev.archive ? buildReviewedArchive({ archive: prev.archive, mergeGroups: nextGroups }) : prev.archive, selectedActionIds: new Set(), anchorActionId: null, mergeDialogOpen: false, pendingMergeActionIds: [] })); } }} /></div><div className="viewer-merge-dialog-actions"><button className="btn-ghost" type="button" onClick={() => { closeMergeDialogState(state); setState({ ...state }); }}>Cancel</button><button className="btn-ghost" type="button" onClick={() => { const validation = validateMergeDialog(state); if (!validation.ok) return setState((prev) => ({ ...prev, mergeDialogError: validation.error })); const newGroup = createMergeGroup({ id: `merge-${Date.now()}`, createdAt: new Date().toISOString(), label: validation.label, selectedActionIds: validation.selectedActionIds }); const nextGroups = [...state.mergeGroups, newGroup]; setState((prev) => ({ ...prev, mergeGroups: nextGroups, archive: prev.archive ? buildReviewedArchive({ archive: prev.archive, mergeGroups: nextGroups }) : prev.archive, selectedActionIds: new Set(), anchorActionId: null, mergeDialogOpen: false, pendingMergeActionIds: [] })); }}>Merge</button></div></div></div> : null}
    </div>
  );
}

function NetworkDetail({ state, setFeedback, setState }: { state: AppState; setFeedback: (t: string, tone: FeedbackTone) => void; setState: React.Dispatch<React.SetStateAction<AppState>> }): React.JSX.Element {
  const idx = state.networkDetailIndex;
  const item = idx === null ? null : state.timeline[idx];
  if (state.activeSection !== "network") return <div className="network-detail network-detail-empty" data-role="network-detail-empty"><div className="network-detail-header"><span className="network-detail-title">Network Request</span></div><div className="network-detail-body"><div className="network-detail-section"><span className="network-body-empty">Switch to the Network tab and select a request to inspect headers and bodies.</span></div></div></div>;
  if (!item || item.kind !== "network" || item.payload.kind !== "network") return <div className="network-detail network-detail-empty" data-role="network-detail-empty"><div className="network-detail-header"><span className="network-detail-title">Network Request</span></div><div className="network-detail-body"><div className="network-detail-section"><span className="network-detail-label">Ready to inspect</span></div></div></div>;
  const p = item.payload;
  const copy = async (value: string, label: string): Promise<void> => {
    try { await navigator.clipboard.writeText(value); setFeedback(`Copied ${label}.`, "success"); } catch { setFeedback(`Failed to copy ${label}.`, "error"); }
  };
  return <div className="network-detail"><div className="network-detail-header"><span className="network-detail-title">Network Request</span><button className="btn-ghost btn-sm" onClick={() => setState((prev) => ({ ...prev, networkDetailIndex: null }))}>✕</button></div><div className="network-detail-body"><div className="network-detail-row"><span className="network-detail-key">Method</span><button className="network-copy-inline network-detail-val" type="button" onClick={() => void copy(p.method, "request method")}>{p.method}</button></div><div className="network-detail-row"><span className="network-detail-key">URL</span><button className="network-copy-inline network-detail-val network-url" type="button" onClick={() => void copy(p.url, "request URL")}>{p.url}</button></div></div></div>;
}

export function bootstrap(): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("Evidence web root element was not found.");
  createRoot(root).render(<App />);
}
