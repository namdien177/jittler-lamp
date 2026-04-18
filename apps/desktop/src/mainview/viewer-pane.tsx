import React from "react";
import { formatOffset, type NetworkSubtype, type TimelineItem, type TimelineSection } from "@jittle-lamp/shared";

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

type ContextState = {
  open: boolean;
  x: number;
  y: number;
  canMerge: boolean;
  canUnmerge: boolean;
};

const SUBTYPE_OPTIONS: Array<{ value: NetworkSubtype | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "xhr", label: "XHR" },
  { value: "fetch", label: "Fetch" },
  { value: "document", label: "Doc" },
  { value: "script", label: "Script" },
  { value: "image", label: "Img" },
  { value: "font", label: "Font" },
  { value: "media", label: "Media" },
  { value: "websocket", label: "WS" },
  { value: "other", label: "Other" }
];

export function ViewerPane(props: {
  activeSection: TimelineSection;
  networkSearchQuery: string;
  networkSubtypeFilter: NetworkSubtype | "all";
  timelineRows: TimelineRow[];
  activeItemId: string | null;
  autoFollow: boolean;
  focusVisible: boolean;
  networkDetail: TimelineItem | null;
  contextMenu: ContextState;
  mergeDialog: { open: boolean; value: string; error: string | null };
  onSectionChange: (section: TimelineSection) => void;
  onSubtypeChange: (value: NetworkSubtype | "all") => void;
  onSearchChange: (value: string) => void;
  onTimelineClick: (itemId: string, offsetMs: number, event: React.MouseEvent<HTMLButtonElement>) => void;
  onTimelineContext: (itemId: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onCloseDetail: () => void;
  onCopy: (value: string, label: string) => void;
  onContextMerge: () => void;
  onContextUnmerge: () => void;
  onDismissContext: () => void;
  onMergeValueChange: (value: string) => void;
  onMergeConfirm: () => void;
  onMergeCancel: () => void;
}): React.JSX.Element {
  const detailPayload = props.networkDetail?.payload.kind === "network" ? props.networkDetail.payload : null;

  return (
    <>
      <div className="viewer-right" onClick={props.onDismissContext}>
        <div className="viewer-section-tabs">
          {(["actions", "console", "network"] as const).map((section) => (
            <button key={section} className="section-tab" type="button" data-active={section === props.activeSection ? "true" : "false"} onClick={() => props.onSectionChange(section)}>{section[0]?.toUpperCase()}{section.slice(1)}</button>
          ))}
        </div>
        <div className="viewer-network-filter" hidden={props.activeSection !== "network"} style={{ display: props.activeSection === "network" ? "flex" : "none" }}>
          {SUBTYPE_OPTIONS.map((option) => (
            <button key={option.value} className="subtype-filter" type="button" data-active={option.value === props.networkSubtypeFilter ? "true" : "false"} onClick={() => props.onSubtypeChange(option.value)}>{option.label}</button>
          ))}
          <input className="viewer-network-search" type="text" value={props.networkSearchQuery} onChange={(event) => props.onSearchChange(event.currentTarget.value)} placeholder="Search URL, headers, response, or /regex/" />
        </div>
        <div className="viewer-section-body">
          <div className="viewer-timeline">
            {props.timelineRows.length === 0 ? <span className="viewer-timeline-empty">No events recorded.</span> : props.timelineRows.map((row) => (
              <button key={row.id} className={`timeline-item${row.merged ? " timeline-item-merged" : ""}`} type="button" data-item-id={row.id} data-active={row.id === props.activeItemId ? "true" : "false"} data-selected={row.selected ? "true" : "false"} onClick={(event) => { event.stopPropagation(); props.onTimelineClick(row.id, row.offsetMs, event); }} onContextMenu={(event) => props.onTimelineContext(row.id, event)}>
                <span className="timeline-offset">{row.mergedRange ?? formatOffset(row.offsetMs)}</span>
                {row.merged ? <span className="tl-merged-badge">merged</span> : null}
                <span className="timeline-label">{row.label}</span>
              </button>
            ))}
          </div>
          <button className="viewer-focus-btn" type="button" hidden={!props.focusVisible} onClick={props.onFocus}>↓ Focus</button>
        </div>
        <div className="viewer-network-detail" hidden={!detailPayload}>
          <div className="viewer-network-detail-header">
            <span className="viewer-panel-label">Network request</span>
            <button className="viewer-detail-close" type="button" onClick={props.onCloseDetail}>✕</button>
          </div>
          {detailPayload ? <div className="viewer-network-detail-body">
            <div className="network-detail-row"><span className="network-detail-key">Method</span><button type="button" data-role="copy" onClick={() => props.onCopy(detailPayload.method, "request method")}>{detailPayload.method}</button></div>
            <div className="network-detail-row"><span className="network-detail-key">URL</span><button type="button" data-role="copy" onClick={() => props.onCopy(detailPayload.url, "request URL")}>{detailPayload.url}</button></div>
          </div> : null}
        </div>
      </div>
      <div className="viewer-context-menu" hidden={!props.contextMenu.open} style={{ left: `${props.contextMenu.x}px`, top: `${props.contextMenu.y}px` }} onClick={(event) => event.stopPropagation()}>
        <button className="context-menu-item" type="button" hidden={!props.contextMenu.canMerge} onClick={props.onContextMerge}>Merge Actions…</button>
        <button className="context-menu-item" type="button" hidden={!props.contextMenu.canUnmerge} onClick={props.onContextUnmerge}>Un-merge</button>
      </div>
      <div className="viewer-merge-dialog-backdrop" hidden={!props.mergeDialog.open} onClick={props.onMergeCancel}>
        <div className="viewer-merge-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="viewer-merge-dialog-header"><span className="viewer-panel-label">Merge actions</span></div>
          <div className="viewer-merge-dialog-body">
            <label className="viewer-merge-dialog-label" htmlFor="viewer-merge-dialog-input">Merged action name</label>
            <input className="viewer-merge-dialog-input" id="viewer-merge-dialog-input" type="text" maxLength={160} value={props.mergeDialog.value} onChange={(event) => props.onMergeValueChange(event.currentTarget.value)} onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); props.onMergeConfirm(); }
              if (event.key === "Escape") { event.preventDefault(); props.onMergeCancel(); }
            }} />
            <div className="viewer-merge-dialog-error" hidden={!props.mergeDialog.error}>{props.mergeDialog.error ?? ""}</div>
          </div>
          <div className="viewer-merge-dialog-actions">
            <button className="button sm" type="button" onClick={props.onMergeCancel}>Cancel</button>
            <button className="button sm primary" type="button" onClick={props.onMergeConfirm}>Merge</button>
          </div>
        </div>
      </div>
    </>
  );
}
