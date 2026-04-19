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
  mergeDialog: { open: boolean; value: string; error: string | null };
  onSectionChange: (section: TimelineSection) => void;
  onSubtypeChange: (value: NetworkSubtype | "all") => void;
  onSearchChange: (value: string) => void;
  onTimelineClick: (itemId: string, offsetMs: number, event: React.MouseEvent<HTMLButtonElement>) => void;
  onTimelineContext: (itemId: string, event: React.MouseEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onCloseDetail: () => void;
  onCopy: (value: string, label: string) => void;
  onMergeValueChange: (value: string) => void;
  onMergeConfirm: () => void;
  onMergeCancel: () => void;
}): React.JSX.Element {
  const detailPayload = props.networkDetail?.payload.kind === "network" ? props.networkDetail.payload : null;
  const statusCode = detailPayload?.status ?? null;
  const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 300;
  const isError = statusCode !== null && statusCode >= 400;
  const statusClass = isSuccess ? "network-status-success" : isError ? "network-status-error" : "";
  const statusText = statusCode !== null
    ? `${statusCode}${detailPayload?.statusText ? ` ${detailPayload.statusText}` : ""}`
    : "—";
  const durationText = detailPayload?.durationMs !== undefined ? `${detailPayload.durationMs.toFixed(0)} ms` : "—";

  return (
    <>
      <div className="viewer-right">
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
            <div className="network-detail-section">
              <span className="network-detail-label">Request</span>
              <div className="network-detail-row"><span className="network-detail-key">Method</span><button className="network-copy-inline network-detail-val" type="button" onClick={() => props.onCopy(detailPayload.method, "request method")}>{detailPayload.method}</button></div>
              <div className="network-detail-row"><span className="network-detail-key">URL</span><button className="network-copy-inline network-detail-val network-url" type="button" onClick={() => props.onCopy(detailPayload.url, "request URL")}>{detailPayload.url}</button></div>
              <div className="network-detail-row"><span className="network-detail-key">Status</span><button className={`network-copy-inline network-detail-val ${statusClass}`.trim()} type="button" onClick={() => props.onCopy(statusText, "response status")}>{statusText}</button></div>
              <div className="network-detail-row"><span className="network-detail-key">Duration</span><button className="network-copy-inline network-detail-val" type="button" onClick={() => props.onCopy(durationText, "request duration")}>{durationText}</button></div>
              {detailPayload.failureText ? <div className="network-detail-row"><span className="network-detail-key">Failure</span><button className="network-copy-inline network-detail-val network-status-error" type="button" onClick={() => props.onCopy(detailPayload.failureText ?? "", "failure message")}>{detailPayload.failureText}</button></div> : null}
            </div>
            <div className="network-detail-section">
              <span className="network-detail-label">Request headers</span>
              {detailPayload.request.headers.length ? detailPayload.request.headers.map((header, index) => (
                <div className="network-header-row" key={`request-${header.name}-${index}`}>
                  <button className="network-copy-inline network-header-name" type="button" onClick={() => props.onCopy(header.name, "header name")}>{header.name}</button>
                  <button className="network-copy-inline network-header-value" type="button" onClick={() => props.onCopy(header.value, "header value")}>{header.value}</button>
                </div>
              )) : <span className="network-body-empty">No headers</span>}
            </div>
            <div className="network-detail-section">
              <span className="network-detail-label">Request body</span>
              <BodyCapture body={detailPayload.request.body} emptyLabel="No request body" onCopy={props.onCopy} />
            </div>
            <div className="network-detail-section">
              <span className="network-detail-label">Response headers</span>
              {detailPayload.response?.headers?.length ? detailPayload.response.headers.map((header, index) => (
                <div className="network-header-row" key={`response-${header.name}-${index}`}>
                  <button className="network-copy-inline network-header-name" type="button" onClick={() => props.onCopy(header.name, "header name")}>{header.name}</button>
                  <button className="network-copy-inline network-header-value" type="button" onClick={() => props.onCopy(header.value, "header value")}>{header.value}</button>
                </div>
              )) : <span className="network-body-empty">No headers</span>}
            </div>
            <div className="network-detail-section">
              <span className="network-detail-label">Response body</span>
              <BodyCapture body={detailPayload.response?.body} emptyLabel="No response body" onCopy={props.onCopy} />
            </div>
          </div> : null}
        </div>
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

function BodyCapture(props: {
  body: TimelineItem["payload"] extends infer T
    ? T extends { kind: "network"; request: { body?: infer U } }
      ? U
      : never
    : never;
  emptyLabel: string;
  onCopy: (value: string, label: string) => void;
}): React.JSX.Element {
  if (!props.body) {
    return <span className="network-body-empty">{props.emptyLabel}</span>;
  }

  if (props.body.disposition === "captured" && props.body.value !== undefined) {
    const previewText = props.body.encoding === "base64"
      ? `[base64, ${props.body.byteLength ?? "?"} bytes]`
      : props.body.value.slice(0, 2000);

    return (
      <button className="network-copy-block" type="button" onClick={() => props.onCopy(props.body?.value ?? "", "request/response body")}>
        <pre className="network-body-pre">{previewText}</pre>
      </button>
    );
  }

  const reasonSuffix = props.body.reason ? ` (${props.body.reason})` : "";
  return <span className="network-body-empty">{`${props.body.disposition}${reasonSuffix}`}</span>;
}
