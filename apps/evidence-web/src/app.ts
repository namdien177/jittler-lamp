import { unzipSync } from "fflate";
import { sessionBundleSchema } from "@jittle-lamp/shared";
import type { SessionBundle, SessionEvent } from "@jittle-lamp/shared";

type TimelineKind = "lifecycle" | "interaction" | "network" | "console" | "error";

type TimelineItem = {
  offsetMs: number;
  event: SessionEvent;
  kind: TimelineKind;
  label: string;
};

type AppPhase = "idle" | "loading" | "error" | "viewing";

type AppState = {
  phase: AppPhase;
  error: string | null;
  bundle: SessionBundle | null;
  videoUrl: string | null;
  timeline: TimelineItem[];
  activeTimelineIndex: number;
  networkDetailIndex: number | null;
  feedback: string | null;
  feedbackTone: "neutral" | "success" | "error";
};

const state: AppState = {
  phase: "idle",
  error: null,
  bundle: null,
  videoUrl: null,
  timeline: [],
  activeTimelineIndex: -1,
  networkDetailIndex: null,
  feedback: null,
  feedbackTone: "neutral"
};

let videoEl: HTMLVideoElement;
let dropArea: HTMLElement;
let fileInput: HTMLInputElement;
let appRoot: HTMLElement;
let delegatedEventsBound = false;

function deriveAnchorMs(events: ReadonlyArray<SessionEvent>): number {
  for (const event of events) {
    if (event.payload.kind === "lifecycle" && event.payload.phase === "recording") {
      return new Date(event.at).getTime();
    }
  }
  let earliest = Infinity;
  for (const event of events) {
    const t = new Date(event.at).getTime();
    if (t < earliest) earliest = t;
  }
  return earliest === Infinity ? 0 : earliest;
}

function buildTimeline(events: ReadonlyArray<SessionEvent>): TimelineItem[] {
  const anchorMs = deriveAnchorMs(events);
  const items: TimelineItem[] = events.map((event) => {
    const offsetMs = new Date(event.at).getTime() - anchorMs;
    const kind = event.payload.kind as TimelineKind;
    const label = buildLabel(event);
    return { offsetMs, event, kind, label };
  });
  items.sort((a, b) => a.offsetMs - b.offsetMs);
  return items;
}

function findActiveIndex(items: ReadonlyArray<TimelineItem>, currentTimeMs: number): number {
  let result = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item !== undefined && item.offsetMs <= currentTimeMs) {
      result = i;
    } else {
      break;
    }
  }
  return result;
}

function formatOffset(offsetMs: number): string {
  const prefix = offsetMs < 0 ? "-" : "";
  const abs = Math.abs(offsetMs);
  const totalSeconds = Math.floor(abs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${prefix}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildLabel(event: SessionEvent): string {
  const p = event.payload;
  switch (p.kind) {
    case "lifecycle":
      return `${p.phase}: ${p.detail}`;
    case "interaction":
      return p.selector !== undefined ? `${p.type} ${p.selector}` : p.type;
    case "network":
      return `${p.method} ${p.url}`;
    case "console":
      return p.message;
    case "error":
      return p.message;
  }
}

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
  render();
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
      if (name === "session.events.json") jsonData = content;
    }

    if (!jsonData) throw new Error("session.events.json not found in ZIP.");
    if (!webmData) throw new Error("recording.webm not found in ZIP.");

    const text = new TextDecoder().decode(jsonData);
    const bundle = sessionBundleSchema.parse(JSON.parse(text));

    if (state.videoUrl) {
      URL.revokeObjectURL(state.videoUrl);
    }

    const recordingArtifact = bundle.artifacts.find((artifact) => artifact.kind === "recording.webm");
    const stableBuffer = Uint8Array.from(webmData).buffer;
    const blob = new Blob([stableBuffer], { type: recordingArtifact?.mimeType || "video/webm" });
    const videoUrl = URL.createObjectURL(blob);

    state.bundle = bundle;
    state.videoUrl = videoUrl;
    state.timeline = buildTimeline(bundle.events);
    state.activeTimelineIndex = -1;
    state.networkDetailIndex = null;
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
  const bundle = state.bundle;
  if (!bundle) return;

  appRoot.innerHTML = `
    <div class="viewer">
      <div class="viewer-header">
        <div class="viewer-header-left">
          <span class="viewer-title">${escapeHtml(bundle.name)}</span>
          <span class="viewer-meta">${escapeHtml(bundle.page.url)}</span>
        </div>
        <div class="viewer-header-right">
          ${state.feedback ? `<span class="feedback feedback-${state.feedbackTone}">${escapeHtml(state.feedback)}</span>` : ""}
          <button class="btn-ghost" id="btn-close" type="button">Close</button>
        </div>
      </div>
      <div class="viewer-body">
        <div class="viewer-left">
          <video id="viewer-video" class="viewer-video" controls></video>
          <div class="viewer-timeline" id="viewer-timeline"></div>
        </div>
        <div class="viewer-right">
          <div class="network-detail" id="network-detail" hidden></div>
        </div>
      </div>
    </div>
  `;

  videoEl = appRoot.querySelector("#viewer-video") as HTMLVideoElement;
  videoEl.src = state.videoUrl ?? "";

  videoEl.addEventListener("timeupdate", () => {
    const currentMs = videoEl.currentTime * 1000;
    const newIndex = findActiveIndex(state.timeline, currentMs);
    if (newIndex !== state.activeTimelineIndex) {
      state.activeTimelineIndex = newIndex;
      updateTimelineHighlight();
    }
  });

  appRoot.querySelector("#btn-close")?.addEventListener("click", () => {
    if (state.videoUrl) {
      URL.revokeObjectURL(state.videoUrl);
      state.videoUrl = null;
    }
    state.phase = "idle";
    state.bundle = null;
    state.timeline = [];
    state.activeTimelineIndex = -1;
    state.networkDetailIndex = null;
    state.feedback = null;
    render();
  });

  renderTimeline();
  renderNetworkDetail();

}

function renderTimeline(): void {
  const container = appRoot.querySelector("#viewer-timeline");
  if (!container) return;

  if (state.timeline.length === 0) {
    container.innerHTML = `<span class="viewer-timeline-empty">No events recorded.</span>`;
    return;
  }

  container.innerHTML = state.timeline
    .map((item, idx) => {
      const isActive = idx === state.activeTimelineIndex;
      return `<button
        class="timeline-item"
        type="button"
        data-role="timeline-item"
        data-index="${idx}"
        data-kind="${escapeHtml(item.kind)}"
        data-active="${isActive ? "true" : "false"}"
      ><span class="timeline-offset">${escapeHtml(formatOffset(item.offsetMs))}</span><span class="timeline-label">${escapeHtml(item.label)}</span></button>`;
    })
    .join("");
}

function updateTimelineHighlight(): void {
  const container = appRoot.querySelector("#viewer-timeline");
  if (!container) return;
  container.querySelectorAll<HTMLButtonElement>("[data-role='timeline-item']").forEach((btn, idx) => {
    btn.dataset.active = idx === state.activeTimelineIndex ? "true" : "false";
  });
}

function renderNetworkDetail(): void {
  const container = appRoot.querySelector<HTMLElement>("#network-detail");
  if (!container) return;

  const idx = state.networkDetailIndex;
  if (idx === null) {
    container.hidden = true;
    return;
  }

  const item = state.timeline[idx];
  if (!item || item.kind !== "network") {
    container.hidden = true;
    return;
  }

  const p = item.event.payload;
  if (p.kind !== "network") {
    container.hidden = true;
    return;
  }

  container.hidden = false;

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

  container.innerHTML = `
    <div class="network-detail-header">
      <span class="network-detail-title">Network Request</span>
      <button class="btn-ghost btn-sm" type="button" id="btn-close-detail">✕</button>
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

  container.querySelector("#btn-close-detail")?.addEventListener("click", () => {
    state.networkDetailIndex = null;
    renderNetworkDetail();
  });
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

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const btn = target.closest<HTMLButtonElement>("[data-role]");
    if (!btn) return;

    if (btn.dataset.role === "timeline-item") {
      const idx = Number(btn.dataset.index);
      const item = state.timeline[idx];
      if (!item) return;
      videoEl.currentTime = item.offsetMs / 1000;
      state.activeTimelineIndex = idx;
      state.networkDetailIndex = item.kind === "network" && state.networkDetailIndex !== idx ? idx : null;
      renderNetworkDetail();
      updateTimelineHighlight();
      return;
    }

    if (btn.dataset.role === "copy-value") {
      const value = btn.dataset.copyValue ?? "";
      const label = btn.dataset.copyLabel ?? "value";
      void copyValue(value, label);
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
