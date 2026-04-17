import { buildSectionTimeline, findActiveIndex, formatOffset, type NetworkSubtype } from "@jittle-lamp/shared";

import type { AppState } from "./viewer-state";

export function render(state: Readonly<AppState>, appRoot: HTMLElement): void {
  switch (state.phase) {
    case "idle":
    case "loading":
    case "error":
      renderDropZone(state, appRoot);
      break;
    case "viewing":
      renderViewer(state, appRoot);
      break;
  }
}

export function renderFeedback(state: Readonly<AppState>, appRoot: HTMLElement): void {
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

export function updateTimelineHighlight(
  state: AppState,
  appRoot: HTMLElement,
  videoEl: HTMLVideoElement,
  scrollState: { isAutoScrolling: boolean }
): void {
  const container = appRoot.querySelector<HTMLElement>("[data-role='viewer-timeline']");
  if (!container) return;

  const section = state.activeSection;
  const buttons = container.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item']");
  let activeBtn: HTMLButtonElement | null = null;

  const items = state.archive ? buildSectionTimeline(state.archive, section, state.networkSubtypeFilter, state.networkSearchQuery) : [];
  const nextActiveIndex = findActiveIndex(items, videoEl.currentTime * 1000);
  state.activeIndex = nextActiveIndex;
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
    scrollState.isAutoScrolling = true;
    (activeBtn as HTMLButtonElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => {
      scrollState.isAutoScrolling = false;
    }, 300);
  }
}

function renderDropZone(state: Readonly<AppState>, appRoot: HTMLElement): void {
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
}

function renderViewer(state: Readonly<AppState>, appRoot: HTMLElement): void {
  const archive = state.archive;
  if (!archive) return;

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
          ${state.activeSection === "network" ? `<div class="viewer-network-filter" data-role="viewer-network-filter">${renderNetworkFilterBar(state.networkSubtypeFilter, state.networkSearchQuery)}</div>` : ""}
          <div class="viewer-section-body" data-role="viewer-section-body">
            <div class="viewer-timeline" data-role="viewer-timeline">${renderTimelineHtml(state)}</div>
            <button class="viewer-focus-btn" data-role="viewer-focus-btn"${state.autoFollow ? " hidden" : ""}>↓ Focus</button>
          </div>
        </div>
        <div class="viewer-right">
          ${renderNetworkPanelHtml(state)}
        </div>
      </div>
    </div>
    <div class="viewer-context-menu" data-role="viewer-context-menu" hidden>
      <button class="context-menu-item" data-role="ctx-merge" type="button">Merge Actions…</button>
      <button class="context-menu-item" data-role="ctx-unmerge" type="button">Un-merge</button>
    </div>
    <div class="viewer-merge-dialog-backdrop" data-role="viewer-merge-dialog-backdrop"${state.mergeDialogOpen ? "" : " hidden"}>
      <div class="viewer-merge-dialog" role="dialog" aria-modal="true" aria-labelledby="viewer-merge-dialog-title">
        <div class="viewer-merge-dialog-header">
          <span class="network-detail-title" id="viewer-merge-dialog-title">Merge Actions</span>
        </div>
        <div class="viewer-merge-dialog-body">
          <label class="viewer-merge-dialog-label" for="viewer-merge-dialog-input">Merged action name</label>
          <input class="viewer-merge-dialog-input" id="viewer-merge-dialog-input" data-role="viewer-merge-dialog-input" type="text" value="${escapeHtml(state.mergeDialogValue)}" maxlength="160" placeholder="Merged actions" />
          <div class="viewer-merge-dialog-error" data-role="viewer-merge-dialog-error"${state.mergeDialogError ? "" : " hidden"}>${state.mergeDialogError ? escapeHtml(state.mergeDialogError) : ""}</div>
        </div>
        <div class="viewer-merge-dialog-actions">
          <button class="btn-ghost" data-role="viewer-merge-dialog-cancel" type="button">Cancel</button>
          <button class="btn-ghost" data-role="viewer-merge-dialog-confirm" type="button">Merge</button>
        </div>
      </div>
    </div>
  `;

  const videoEl = appRoot.querySelector<HTMLVideoElement>("[data-role='viewer-video']");
  if (videoEl) {
    videoEl.src = state.videoUrl ?? "";
  }

  const mergeInput = appRoot.querySelector<HTMLInputElement>("[data-role='viewer-merge-dialog-input']");
  if (state.mergeDialogOpen && mergeInput) {
    queueMicrotask(() => mergeInput.focus());
  }
}

function renderNetworkFilterBar(
  networkSubtypeFilter: NetworkSubtype | "all",
  networkSearchQuery: string
): string {
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
      const isActive = s.value === networkSubtypeFilter;
      const emphClass = s.emphasis ? " subtype-emphasis" : "";
      return `<button class="subtype-filter${emphClass}" data-role="subtype-filter" data-subtype="${s.value}" data-active="${isActive ? "true" : "false"}" type="button">${s.label}</button>`;
    })
    .join("")}
    <input class="viewer-network-search" type="text" data-role="network-search" value="${escapeHtml(networkSearchQuery)}" placeholder="Search URL, headers, response, or /regex/" />`;
}

function renderTimelineHtml(state: Readonly<AppState>): string {
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
      const isActive = idx === state.activeIndex;
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

function renderNetworkDetailHtml(state: Readonly<AppState>): string {
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

function renderNetworkPanelHtml(state: Readonly<AppState>): string {
  if (state.activeSection !== "network") {
    return `<div class="network-detail network-detail-empty" data-role="network-detail-empty"><div class="network-detail-header"><span class="network-detail-title">Network Request</span></div><div class="network-detail-body"><div class="network-detail-section"><span class="network-body-empty">Switch to the Network tab and select a request to inspect headers and bodies.</span></div></div></div>`;
  }

  if (state.networkDetailIndex === null) {
    return `<div class="network-detail network-detail-empty" data-role="network-detail-empty"><div class="network-detail-header"><span class="network-detail-title">Network Request</span></div><div class="network-detail-body"><div class="network-detail-section"><span class="network-detail-label">Ready to inspect</span><div class="network-detail-row"><span class="network-detail-key">Search</span><span class="network-detail-val">Use plain text or /regex/ to match URL, header values, or response content.</span></div><div class="network-detail-row"><span class="network-detail-key">Selection</span><span class="network-detail-val">Choose a request from the timeline to open full details here.</span></div></div></div></div>`;
  }

  return `<div class="network-detail" data-role="network-detail">${renderNetworkDetailHtml(state)}</div>`;
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

function renderCopyableValue(value: string, label: string, className: string): string {
  return `<button class="network-copy-inline ${className}" type="button" data-role="copy-value" data-copy-label="${escapeHtml(label)}" data-copy-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
