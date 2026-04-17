import type { DesktopCompanionConfigSnapshot, DesktopCompanionRuntimeSnapshot, SessionRecord } from "../rpc";

export type DatePreset = "today" | "week" | "month" | "all";

export function filterSessions(input: {
  sessions: SessionRecord[];
  tagFilter: string | null;
  dateFilter: DatePreset;
  now?: number;
}): SessionRecord[] {
  const now = input.now ?? Date.now();
  const dayMs = 86_400_000;

  return input.sessions.filter((session) => {
    if (input.tagFilter !== null && !session.tags.includes(input.tagFilter)) {
      return false;
    }

    if (input.dateFilter !== "all") {
      const recordedAt = new Date(session.recordedAt).getTime();
      if (Number.isNaN(recordedAt)) return false;

      if (input.dateFilter === "today" && now - recordedAt > dayMs) return false;
      if (input.dateFilter === "week" && now - recordedAt > 7 * dayMs) return false;
      if (input.dateFilter === "month" && now - recordedAt > 30 * dayMs) return false;
    }

    return true;
  });
}

export function renderTagFilterHtml(tagFilter: string | null, escapeHtml: (value: string) => string): string {
  if (tagFilter !== null) {
    return `
      <span class="active-tag-chip">
        ${escapeHtml(tagFilter)}
        <button class="tag-chip-remove" type="button" data-role="tag-filter-remove" aria-label="Remove tag filter">✕</button>
      </span>
    `;
  }

  return `
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

export function renderTagAutocompleteHtml(tags: string[], escapeHtml: (value: string) => string): string {
  return tags
    .map(
      (tag) =>
        `<button class="tag-option" type="button" data-role="tag-filter-option" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
    )
    .join("");
}

export function renderInlineTagAutocompleteHtml(input: {
  sessionId: string;
  tags: string[];
  escapeHtml: (value: string) => string;
}): string {
  return input.tags
    .map(
      (tag) =>
        `<button class="tag-option" type="button" data-role="tag-inline-option" data-session-id="${input.escapeHtml(input.sessionId)}" data-tag="${input.escapeHtml(tag)}">${input.escapeHtml(tag)}</button>`
    )
    .join("");
}

export function renderSessionsHtml(input: {
  sessions: SessionRecord[];
  pendingDeleteId: string | null;
  editingTagSessionId: string | null;
  tagInputValue: string;
  escapeHtml: (value: string) => string;
  formatRelativeTime: (isoTimestamp: string) => string;
  formatBytes: (bytes: number) => string;
}): string {
  if (input.sessions.length === 0) {
    return `
      <div class="empty-state">
        <span>No sessions found.</span>
        <span class="empty-hint">Start a browser recording with the extension to populate this list.</span>
      </div>
    `;
  }

  return input.sessions
    .map((session) => {
      const shortId =
        session.sessionId.length > 24
          ? `${session.sessionId.slice(0, 10)}…${session.sessionId.slice(-8)}`
          : session.sessionId;

      const hasWebm = session.artifacts.some((a) => a.artifactName === "recording.webm");
      const hasJson = session.artifacts.some((a) => a.artifactName === "session.archive.json");
      const isPending = input.pendingDeleteId === session.sessionId;
      const isEditing = input.editingTagSessionId === session.sessionId;

      const tagChips = session.tags
        .map(
          (tag) =>
            `<span class="tag-chip">${input.escapeHtml(tag)}<button class="tag-chip-x" type="button" data-role="tag-chip-x" data-session-id="${input.escapeHtml(session.sessionId)}" data-tag="${input.escapeHtml(tag)}" aria-label="Remove tag ${input.escapeHtml(tag)}">✕</button></span>`
        )
        .join("");

      const tagEditor = isEditing
        ? `<div class="tag-editor-wrap">
            <input
              class="tag-input-inline"
              type="text"
              data-role="tag-input-inline"
              data-session-id="${input.escapeHtml(session.sessionId)}"
              value="${input.escapeHtml(input.tagInputValue)}"
              placeholder="tag name"
              autocomplete="off"
            />
            <div class="tag-autocomplete" data-role="tag-inline-autocomplete" data-session-id="${input.escapeHtml(session.sessionId)}" hidden></div>
          </div>`
        : `<button class="tag-add-btn" type="button" data-role="tag-add-btn" data-session-id="${input.escapeHtml(session.sessionId)}">+ tag</button>`;

      return `
        <article class="session-card">
          <div class="session-head">
            <span class="session-id" title="${input.escapeHtml(session.sessionId)}">${input.escapeHtml(shortId)}</span>
            <span class="session-time">${input.escapeHtml(input.formatRelativeTime(session.recordedAt))}</span>
          </div>
          <div class="session-artifacts">
            <span class="artifact-tag ${hasWebm ? "artifact-present" : "artifact-missing"}">webm</span>
            <span class="artifact-tag ${hasJson ? "artifact-present" : "artifact-missing"}">json</span>
            <span class="session-size">${input.escapeHtml(input.formatBytes(session.totalBytes))}</span>
          </div>
          <div class="session-tags">
            ${tagChips}
            ${tagEditor}
          </div>
          <p class="session-path">${input.escapeHtml(session.sessionFolder)}</p>
          <div class="session-actions">
            <button class="button ghost sm" type="button" data-role="session-view-btn" data-session-id="${input.escapeHtml(session.sessionId)}">View</button>
            <button class="button ghost sm" type="button" data-role="session-open-btn" data-session-id="${input.escapeHtml(session.sessionId)}">Open</button>
            <button class="button ghost sm" type="button" data-role="session-zip-btn" data-session-id="${input.escapeHtml(session.sessionId)}">ZIP</button>
            <button class="button ghost sm${isPending ? " session-delete-confirm" : ""}" type="button" data-role="session-delete-btn" data-session-id="${input.escapeHtml(session.sessionId)}">
              ${isPending ? "Confirm?" : "Delete"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

export function isDatePreset(value: string | undefined): value is DatePreset {
  return value === "today" || value === "week" || value === "month" || value === "all";
}

export function formatSourceLabel(source: DesktopCompanionConfigSnapshot["source"]): string {
  switch (source) {
    case "env":
      return "Environment override";
    case "file":
      return "Saved file";
    case "default":
      return "Default";
  }
}

export function formatRuntimeLabel(status?: DesktopCompanionRuntimeSnapshot["status"]): string {
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
