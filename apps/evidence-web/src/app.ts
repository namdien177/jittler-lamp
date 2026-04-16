import { unzipSync } from "fflate";
import { sessionArchiveSchema } from "@jittle-lamp/shared";
import type { SessionArchive } from "@jittle-lamp/shared";
import type { ActionMergeGroup, NetworkSubtype } from "@jittle-lamp/shared";
import { buildSectionTimeline, buildTimeline, buildVisibleActionRangeSelection, findActiveIndex, formatOffset, getContiguousMergeableActionIds } from "../../desktop/src/mainview/timeline";
import type { TimelineItem, TimelineSection } from "../../desktop/src/mainview/timeline";
import { buildReviewedArchive, buildReviewedSessionZip } from "./archive-export";

type AppPhase = "idle" | "loading" | "error" | "viewing";

type AppState = {
  phase: AppPhase;
  error: string | null;
  archive: SessionArchive | null;
  videoUrl: string | null;
  recordingBytes: Uint8Array | null;
  timeline: TimelineItem[];
  activeTimelineIndex: number;
  networkDetailIndex: number | null;
  networkSearchQuery: string;
  feedback: string | null;
  feedbackTone: "neutral" | "success" | "error";
  activeSection: TimelineSection;
  networkSubtypeFilter: NetworkSubtype | "all";
  autoFollow: boolean;
  selectedActionIds: Set<string>;
  anchorActionId: string | null;
  mergeGroups: ActionMergeGroup[];
};

const state: AppState = {
  phase: "idle",
  error: null,
  archive: null,
  videoUrl: null,
  recordingBytes: null,
  timeline: [],
  activeTimelineIndex: -1,
  networkDetailIndex: null,
  networkSearchQuery: "",
  feedback: null,
  feedbackTone: "neutral",
  activeSection: "actions",
  networkSubtypeFilter: "all",
  autoFollow: true,
  selectedActionIds: new Set(),
  anchorActionId: null,
  mergeGroups: []
};

let videoEl: HTMLVideoElement;
let dropArea: HTMLElement;
let fileInput: HTMLInputElement;
let appRoot: HTMLElement;
let delegatedEventsBound = false;
let isAutoScrolling = false;

let ctxTargetId: string | null = null;
let ctxIsMerged = false;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCopyableValue(value: string, label: string, className: string): string {
  return `<button class="network-copy-inline ${className}" type="button" data-role="copy-value" data-copy-label="${escapeHtml(label)}" data-copy-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`;
}

function renderBodyCapture(body: {
  disposition: string;
  encoding?: "utf8" | "base64" | undefined;
  mimeType?: string | undefined;
  value?: string | undefined;
  byteLength?: number | undefined;
  omittedByteLength?: number | undefined;
  reason?: string | undefined;
}): string {
  if (body.disposition === "captured" && body.value !== undefined) {
    const display =
      body.encoding === "base64"
        ? `[base64, ${body.byteLength ?? "?"} bytes]`
        : escapeHtml(body.value.slice(0, 2000));
    return `<button class="network-copy-block" type="button" data-role="copy-value" data-copy-label="request detail" data-copy-value="${escapeHtml(body.value)}"><pre class="network-body-pre">${display}</pre></button>`;
  }
  const reason = body.reason ? ` (${body.reason})` : "";
  return `<span class="network-body-empty">${escapeHtml(body.disposition)}${escapeHtml(reason)}</span>`;
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
}

function setFeedback(text: string, tone: "neutral" | "success" | "error"): void {
  state.feedback = text;
  state.feedbackTone = tone;
  renderFeedback();
}

function renderFeedback(): void {
  const el = appRoot.querySelector<HTMLElement>("[data-role='viewer-feedback']");
  if (!el) return;
  if (state.feedback) {
    el.textContent = state.feedback;
    el.className = `feedback feedback-${state.feedbackTone}`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

async function handleFile(file: File): Promise<void> {
  if (state.phase === "loading") return;

  state.phase = "loading";
  state.error = null;
  render();

  try {
    const buffer = await file.arrayBuffer();
    const files = unzipSync(new Uint8Array(buffer));

    let webmData: Uint8Array | null = null;
    let jsonData: Uint8Array | null = null;

    for (const [path, content] of Object.entries(files)) {
      const name = path.split("/").pop();
      if (name === "recording.webm") webmData = content;
       if (name === "session.archive.json") jsonData = content;
    }

    if (!jsonData) throw new Error("session.archive.json not found in ZIP.");
    if (!webmData) throw new Error("recording.webm not found in ZIP.");

    const text = new TextDecoder().decode(jsonData);
    const archive = sessionArchiveSchema.parse(JSON.parse(text));

    if (state.videoUrl) {
      URL.revokeObjectURL(state.videoUrl);
    }

    const recordingArtifact = archive.artifacts.find((artifact) => artifact.kind === "recording.webm");
    const stableBuffer = Uint8Array.from(webmData).buffer;
    const blob = new Blob([stableBuffer], { type: recordingArtifact?.mimeType || "video/webm" });
    const videoUrl = URL.createObjectURL(blob);

    state.archive = archive;
    state.videoUrl = videoUrl;
    state.recordingBytes = Uint8Array.from(webmData);
    state.timeline = buildTimeline(archive);
    state.activeTimelineIndex = -1;
    state.networkDetailIndex = null;
    state.networkSearchQuery = "";
    state.activeSection = "actions";
    state.networkSubtypeFilter = "all";
    state.autoFollow = true;
    state.selectedActionIds = new Set();
    state.anchorActionId = null;
    state.mergeGroups = (archive.annotations ?? []).filter(
      (a): a is ActionMergeGroup => a.kind === "merge-group"
    );
    state.phase = "viewing";
    state.feedback = null;
  } catch (err) {
    state.phase = "error";
    state.error = err instanceof Error ? err.message : String(err);
  }

  render();
}

function render(): void {
  if (!appRoot) return;

  switch (state.phase) {
    case "idle":
    case "loading":
    case "error":
      renderDropZone();
      break;
    case "viewing":
      renderViewer();
      break;
  }
}

function renderDropZone(): void {
  const isLoading = state.phase === "loading";
  const isError = state.phase === "error";

  appRoot.innerHTML = `
    <div class="drop-zone">
      <div class="drop-area" id="drop-area" data-dragover="false">
        <div class="drop-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <p class="drop-title">${isLoading ? "Loading…" : "Drop a session ZIP here"}</p>
        <p class="drop-sub">${isLoading ? "Extracting and validating…" : "or click to browse"}</p>
        ${isError ? `<p class="drop-error">${escapeHtml(state.error ?? "Unknown error")}</p>` : ""}
        ${!isLoading ? `<label class="drop-btn"><input type="file" id="file-input" accept=".zip" style="display:none">Browse file</label>` : ""}
      </div>
    </div>
  `;

  dropArea = appRoot.querySelector("#drop-area") as HTMLElement;
  fileInput = appRoot.querySelector("#file-input") as HTMLInputElement;

  if (!isLoading) {
    dropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropArea.dataset.dragover = "true";
    });
    dropArea.addEventListener("dragleave", () => {
      dropArea.dataset.dragover = "false";
    });
    dropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      dropArea.dataset.dragover = "false";
      const file = e.dataTransfer?.files[0];
      if (file) void handleFile(file);
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) void handleFile(file);
    });
  }
}

function renderViewer(): void {
  const archive = state.archive;
  if (!archive) return;

  const isNetworkSection = state.activeSection === "network";

  appRoot.innerHTML = `
    <div class="viewer">
      <div class="viewer-header">
        <div class="viewer-header-left">
          <span class="viewer-title">${escapeHtml(archive.name)}</span>
          <span class="viewer-meta">${escapeHtml(archive.page.url)}</span>
        </div>
        <div class="viewer-header-right">
          <span data-role="viewer-feedback" class="feedback feedback-${state.feedbackTone}"${state.feedback ? "" : " hidden"}>${state.feedback ? escapeHtml(state.feedback) : ""}</span>
          <button class="btn-ghost" data-role="btn-export" type="button">Export Updated ZIP</button>
          <button class="btn-ghost" data-role="btn-close" type="button">Close</button>
        </div>
      </div>
      <div class="viewer-body">
        <div class="viewer-left">
          <video data-role="viewer-video" class="viewer-video" controls></video>
          <div class="viewer-section-tabs" data-role="viewer-section-tabs">
            <button class="section-tab" data-role="section-tab" data-section="actions" data-active="${state.activeSection === "actions" ? "true" : "false"}">Actions</button>
            <button class="section-tab" data-role="section-tab" data-section="console" data-active="${state.activeSection === "console" ? "true" : "false"}">Console</button>
            <button class="section-tab" data-role="section-tab" data-section="network" data-active="${state.activeSection === "network" ? "true" : "false"}">Network</button>
          </div>
          <div class="viewer-network-filter" data-role="viewer-network-filter"${isNetworkSection ? "" : " hidden"}>
            ${renderNetworkFilterBar()}
          </div>
          <div class="viewer-section-body" data-role="viewer-section-body">
            <div class="viewer-timeline" data-role="viewer-timeline">${renderTimelineHtml()}</div>
            <button class="viewer-focus-btn" data-role="viewer-focus-btn"${state.autoFollow ? " hidden" : ""}>↓ Focus</button>
          </div>
        </div>
        <div class="viewer-right">
          ${renderNetworkPanelHtml()}
        </div>
      </div>
    </div>
    <div class="viewer-context-menu" data-role="viewer-context-menu" hidden>
      <button class="context-menu-item" data-role="ctx-merge" type="button">Merge Actions…</button>
      <button class="context-menu-item" data-role="ctx-unmerge" type="button">Un-merge</button>
    </div>
  `;

  videoEl = appRoot.querySelector("[data-role='viewer-video']") as HTMLVideoElement;
  videoEl.src = state.videoUrl ?? "";

  videoEl.addEventListener("timeupdate", () => {
    updateTimelineHighlight();
  });
}

function renderNetworkFilterBar(): string {
  const subtypes: Array<{ value: NetworkSubtype | "all"; label: string; emphasis?: boolean }> = [
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

  return `${subtypes
    .map((s) => {
      const isActive = s.value === state.networkSubtypeFilter;
      const emphClass = s.emphasis ? " subtype-emphasis" : "";
      return `<button class="subtype-filter${emphClass}" data-role="subtype-filter" data-subtype="${s.value}" data-active="${isActive ? "true" : "false"}" type="button">${s.label}</button>`;
    })
    .join("")}
    <input class="viewer-network-search" type="text" data-role="network-search" value="${escapeHtml(state.networkSearchQuery)}" placeholder="Search URL, headers, response, or /regex/" />`;
}

function renderTimelineHtml(): string {
  const archive = state.archive;
  if (!archive) return `<span class="viewer-timeline-empty">No events recorded.</span>`;

  const section = state.activeSection;
  const items = buildSectionTimeline(archive, section, state.networkSubtypeFilter, state.networkSearchQuery);

  if (section === "actions") {
    const mergedMemberIds = new Set(state.mergeGroups.flatMap((g) => g.memberIds));
    const rows: string[] = [];
    const seenGroupIds = new Set<string>();

    for (const item of items) {
      const group = state.mergeGroups.find((g) => g.memberIds.includes(item.id));

      if (group) {
        if (seenGroupIds.has(group.id)) continue;
        seenGroupIds.add(group.id);

        const memberItems = items.filter((i) => group.memberIds.includes(i.id));
        const firstMs = Math.min(...memberItems.map((i) => i.offsetMs));
        const lastMs = Math.max(...memberItems.map((i) => i.offsetMs));
        const tagChips = group.tags.map((t) => `<span class="tl-tag">${escapeHtml(t)}</span>`).join("");
        const isSelected = state.selectedActionIds.has(group.id);

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

      const isSelected = state.selectedActionIds.has(item.id);
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

    return rows.length > 0 ? rows.join("") : `<span class="viewer-timeline-empty">No actions recorded.</span>`;
  }

  if (items.length === 0) {
    return `<span class="viewer-timeline-empty">No ${section} events recorded.</span>`;
  }

  return items
    .map((item, idx) => {
      const isActive = idx === state.activeTimelineIndex;
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

function updateTimelineHighlight(): void {
  const container = appRoot.querySelector<HTMLElement>("[data-role='viewer-timeline']");
  if (!container) return;

  const section = state.activeSection;
  const buttons = container.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item']");
  let activeBtn: HTMLButtonElement | null = null;

  const items = state.archive ? buildSectionTimeline(state.archive, section, state.networkSubtypeFilter, state.networkSearchQuery) : [];
  const nextActiveIndex = findActiveIndex(items, videoEl.currentTime * 1000);
  state.activeTimelineIndex = nextActiveIndex;
  const activeItem = nextActiveIndex >= 0 ? items[nextActiveIndex] : undefined;
  const activeItemId = (() => {
    if (!activeItem) return null;
    if (section !== "actions") return activeItem.id;
    return state.mergeGroups.find((group) => group.memberIds.includes(activeItem.id))?.id ?? activeItem.id;
  })();

  buttons.forEach((btn, idx) => {
    const isActive = section === "actions" ? btn.dataset.itemId === activeItemId : idx === nextActiveIndex;
    btn.dataset.active = isActive ? "true" : "false";
    if (isActive) activeBtn = btn;
  });

  if (state.autoFollow && activeBtn !== null) {
    isAutoScrolling = true;
    (activeBtn as HTMLButtonElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => { isAutoScrolling = false; }, 300);
  }
}

function renderNetworkDetailHtml(): string {
  const idx = state.networkDetailIndex;
  if (idx === null) return "";

  const item = state.timeline[idx];
  if (!item || item.kind !== "network") return "";

  const p = item.payload;
  if (p.kind !== "network") return "";

  const statusCode = p.status ?? null;
  const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 300;
  const isError = statusCode !== null && statusCode >= 400;
  const statusClass = isSuccess ? "network-status-success" : isError ? "network-status-error" : "";
  const statusText = statusCode !== null ? `${statusCode}${p.statusText ? ` ${p.statusText}` : ""}` : "—";
  const durationText = p.durationMs !== undefined ? `${p.durationMs.toFixed(0)} ms` : "—";

  const reqHeaders = p.request.headers
    .map(
      (h) =>
        `<div class="network-header-row">${renderCopyableValue(h.name, "header name", "network-header-name")} ${renderCopyableValue(h.value, "header value", "network-header-value")}</div>`
    )
    .join("");

  const resHeaders = (p.response?.headers ?? [])
    .map(
      (h) =>
        `<div class="network-header-row">${renderCopyableValue(h.name, "header name", "network-header-name")} ${renderCopyableValue(h.value, "header value", "network-header-value")}</div>`
    )
    .join("");

  const reqBody = p.request.body
    ? renderBodyCapture(p.request.body)
    : `<span class="network-body-empty">No request body</span>`;

  const resBody = p.response?.body
    ? renderBodyCapture(p.response.body)
    : `<span class="network-body-empty">No response body</span>`;

  return `
    <div class="network-detail-header">
      <span class="network-detail-title">Network Request</span>
      <button class="btn-ghost btn-sm" type="button" data-role="btn-close-detail">✕</button>
    </div>
    <div class="network-detail-body">
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
    </div>
  `;
}

function renderNetworkPanelHtml(): string {
  if (state.activeSection !== "network") {
    return `<div class="network-detail network-detail-empty" data-role="network-detail-empty"><div class="network-detail-header"><span class="network-detail-title">Network Request</span></div><div class="network-detail-body"><div class="network-detail-section"><span class="network-body-empty">Switch to the Network tab and select a request to inspect headers and bodies.</span></div></div></div>`;
  }

  if (state.networkDetailIndex === null) {
    return `<div class="network-detail network-detail-empty" data-role="network-detail-empty"><div class="network-detail-header"><span class="network-detail-title">Network Request</span></div><div class="network-detail-body"><div class="network-detail-section"><span class="network-detail-label">Ready to inspect</span><div class="network-detail-row"><span class="network-detail-key">Search</span><span class="network-detail-val">Use plain text or /regex/ to match URL, header values, or response content.</span></div><div class="network-detail-row"><span class="network-detail-key">Selection</span><span class="network-detail-val">Choose a request from the timeline to open full details here.</span></div></div></div></div>`;
  }

  return `<div class="network-detail" data-role="network-detail">${renderNetworkDetailHtml()}</div>`;
}

function hideContextMenu(): void {
  const menu = appRoot.querySelector<HTMLElement>("[data-role='viewer-context-menu']");
  if (menu) menu.hidden = true;
  ctxTargetId = null;
  ctxIsMerged = false;
}

function showContextMenu(x: number, y: number, targetId: string, isMerged: boolean): void {
  const menu = appRoot.querySelector<HTMLElement>("[data-role='viewer-context-menu']");
  if (!menu) return;

  ctxTargetId = targetId;
  ctxIsMerged = isMerged;

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

  return getContiguousMergeableActionIds(state.archive, state.mergeGroups, state.selectedActionIds);
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
}

function init(): void {
  appRoot = document.getElementById("app") as HTMLElement;
  bindDelegatedEvents();
  render();
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
        state.videoUrl = null;
      }
      state.phase = "idle";
      state.archive = null;
      state.recordingBytes = null;
      state.timeline = [];
      state.activeTimelineIndex = -1;
      state.networkDetailIndex = null;
      state.networkSearchQuery = "";
      state.feedback = null;
      state.activeSection = "actions";
      state.networkSubtypeFilter = "all";
      state.autoFollow = true;
      state.selectedActionIds = new Set();
      state.anchorActionId = null;
      state.mergeGroups = [];
      render();
      return;
    }

    if (role === "btn-export") {
      downloadUpdatedZip();
      return;
    }

    if (role === "btn-close-detail") {
      state.networkDetailIndex = null;
      const panel = appRoot.querySelector<HTMLElement>(".viewer-right");
      if (panel) panel.innerHTML = renderNetworkPanelHtml();
      return;
    }

    if (role === "section-tab") {
      const section = btn.dataset.section as TimelineSection | undefined;
      if (!section) return;
      state.activeSection = section;
      state.activeTimelineIndex = -1;
      state.networkDetailIndex = null;

      appRoot.querySelectorAll<HTMLButtonElement>("[data-role='section-tab']").forEach((tab) => {
        tab.dataset.active = tab.dataset.section === section ? "true" : "false";
      });

      const filterBar = appRoot.querySelector<HTMLElement>("[data-role='viewer-network-filter']");
      if (filterBar) filterBar.hidden = section !== "network";

      const timelineEl = appRoot.querySelector<HTMLElement>("[data-role='viewer-timeline']");
      if (timelineEl) timelineEl.innerHTML = renderTimelineHtml();

      const panel = appRoot.querySelector<HTMLElement>(".viewer-right");
      if (panel) panel.innerHTML = renderNetworkPanelHtml();
      updateTimelineHighlight();
      return;
    }

    if (role === "subtype-filter") {
      const subtype = btn.dataset.subtype as NetworkSubtype | "all" | undefined;
      if (!subtype) return;
      state.networkSubtypeFilter = subtype;
      state.networkDetailIndex = null;

      appRoot.querySelectorAll<HTMLButtonElement>("[data-role='subtype-filter']").forEach((b) => {
        b.dataset.active = b.dataset.subtype === subtype ? "true" : "false";
      });

      const timelineEl = appRoot.querySelector<HTMLElement>("[data-role='viewer-timeline']");
      if (timelineEl) timelineEl.innerHTML = renderTimelineHtml();
      const panel = appRoot.querySelector<HTMLElement>(".viewer-right");
      if (panel) panel.innerHTML = renderNetworkPanelHtml();
      updateTimelineHighlight();
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
        return;
      }
      const label = window.prompt("Merge group label:", "Merged actions");
      if (!label) return;

      const newGroup: ActionMergeGroup = {
        id: `merge-${Date.now()}`,
        kind: "merge-group",
        memberIds: selectedIds,
        tags: [],
        label,
        createdAt: new Date().toISOString()
      };
      state.mergeGroups = [...state.mergeGroups, newGroup];
      state.archive = getReviewedArchive();
      state.selectedActionIds = new Set();
      state.anchorActionId = null;

      const timelineEl = appRoot.querySelector<HTMLElement>("[data-role='viewer-timeline']");
      if (timelineEl) timelineEl.innerHTML = renderTimelineHtml();
      updateTimelineHighlight();
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

      const timelineEl = appRoot.querySelector<HTMLElement>("[data-role='viewer-timeline']");
      if (timelineEl) timelineEl.innerHTML = renderTimelineHtml();
      updateTimelineHighlight();
      return;
    }

    if (role === "timeline-item") {
      const section = btn.dataset.section as TimelineSection | undefined;
      const itemId = btn.dataset.itemId;
      const isMerged = btn.dataset.merged === "true";

      if (section === "actions") {
        if (event.metaKey || event.ctrlKey) {
          if (!itemId) return;
          const next = new Set(state.selectedActionIds);
          if (next.has(itemId)) {
            next.delete(itemId);
          } else {
            next.add(itemId);
            state.anchorActionId = itemId;
          }
          state.selectedActionIds = next;
          btn.dataset.selected = state.selectedActionIds.has(itemId) ? "true" : "false";
          return;
        }

        if (event.shiftKey && state.anchorActionId && itemId) {
          const rangeIds = buildVisibleActionRangeSelection(state.archive!, state.mergeGroups, state.anchorActionId, itemId);
          if (rangeIds.length > 0) {
            state.selectedActionIds = new Set(rangeIds);
            appRoot.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item'][data-section='actions']").forEach((b) => {
              const bid = b.dataset.itemId;
              if (bid) b.dataset.selected = state.selectedActionIds.has(bid) ? "true" : "false";
            });
          }
          return;
        }

        if (itemId) {
          state.selectedActionIds = new Set([itemId]);
          state.anchorActionId = itemId;
          appRoot.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item'][data-section='actions']").forEach((b) => {
            b.dataset.selected = b.dataset.itemId === itemId ? "true" : "false";
          });
        }

        if (btn.dataset.offsetMs) {
          const offsetMs = Number(btn.dataset.offsetMs);
          if (videoEl) videoEl.currentTime = offsetMs / 1000;
        }
        updateTimelineHighlight();
        return;
      }

      const idx = Number(btn.dataset.index);
      const item = state.timeline.find((t) => t.id === itemId);
      if (!item) return;

      if (videoEl) videoEl.currentTime = item.offsetMs / 1000;
      state.activeTimelineIndex = idx;

      if (section === "network") {
        const networkIdx = state.timeline.indexOf(item);
        const isAlreadyOpen = state.networkDetailIndex === networkIdx;
        state.networkDetailIndex = isAlreadyOpen ? null : networkIdx;

        const detailEl = appRoot.querySelector<HTMLElement>("[data-role='network-detail']");
        const panel = appRoot.querySelector<HTMLElement>(".viewer-right");
        if (panel) panel.innerHTML = renderNetworkPanelHtml();
      }

      updateTimelineHighlight();
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
      state.selectedActionIds = new Set([itemId]);
      state.anchorActionId = itemId;
      appRoot.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item'][data-section='actions']").forEach((b) => {
        b.dataset.selected = b.dataset.itemId === itemId ? "true" : "false";
      });
    }

    showContextMenu(event.clientX, event.clientY, itemId, isMerged);
  });

  appRoot.addEventListener("scroll", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest("[data-role='viewer-section-body']")) return;
    if (isAutoScrolling) return;

    if (state.autoFollow) {
      state.autoFollow = false;
      const focusBtn = appRoot.querySelector<HTMLElement>("[data-role='viewer-focus-btn']");
      if (focusBtn) focusBtn.hidden = false;
    }
  }, true);

  appRoot.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.role !== "network-search") return;

    state.networkSearchQuery = target.value;
    state.networkDetailIndex = null;

    const timelineEl = appRoot.querySelector<HTMLElement>("[data-role='viewer-timeline']");
    if (timelineEl) timelineEl.innerHTML = renderTimelineHtml();
    const panel = appRoot.querySelector<HTMLElement>(".viewer-right");
    if (panel) panel.innerHTML = renderNetworkPanelHtml();
    updateTimelineHighlight();
  });
}

document.addEventListener("DOMContentLoaded", init);
