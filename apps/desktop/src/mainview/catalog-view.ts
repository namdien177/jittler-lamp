import type { DesktopCompanionConfigSnapshot, DesktopCompanionRuntimeSnapshot, SessionRecord } from "../rpc";

export type DatePreset = "today" | "week" | "month" | "all";

export type SessionSortKey = "newest" | "oldest" | "size-desc" | "size-asc" | "id-asc";

export type SessionFilters = {
  sessions: SessionRecord[];
  tagFilter: string | null;
  dateFilter: DatePreset;
  searchQuery?: string;
  sort?: SessionSortKey;
  now?: number;
};

export function filterSessions(input: SessionFilters): SessionRecord[] {
  const now = input.now ?? Date.now();
  const dayMs = 86_400_000;
  const search = input.searchQuery?.trim().toLowerCase() ?? "";

  const filtered = input.sessions.filter((session) => {
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

    if (search) {
      const haystack = [
        session.sessionId,
        session.sessionFolder,
        session.notes,
        ...session.tags
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });

  const sort = input.sort ?? "newest";
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (sort) {
      case "oldest":
        return a.recordedAt.localeCompare(b.recordedAt);
      case "size-desc":
        return b.totalBytes - a.totalBytes;
      case "size-asc":
        return a.totalBytes - b.totalBytes;
      case "id-asc":
        return a.sessionId.localeCompare(b.sessionId);
      case "newest":
      default:
        return b.recordedAt.localeCompare(a.recordedAt);
    }
  });
  return sorted;
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

export function groupSessionsByDate(
  sessions: SessionRecord[],
  now: number = Date.now()
): { label: string; sessions: SessionRecord[] }[] {
  const dayMs = 86_400_000;
  const buckets = new Map<string, SessionRecord[]>();

  const order = ["Today", "Yesterday", "This week", "This month", "Earlier"];
  for (const label of order) buckets.set(label, []);

  for (const session of sessions) {
    const recorded = new Date(session.recordedAt).getTime();
    const delta = Number.isNaN(recorded) ? Number.POSITIVE_INFINITY : now - recorded;
    let label = "Earlier";
    if (delta < dayMs) label = "Today";
    else if (delta < 2 * dayMs) label = "Yesterday";
    else if (delta < 7 * dayMs) label = "This week";
    else if (delta < 30 * dayMs) label = "This month";
    buckets.get(label)?.push(session);
  }

  return order
    .map((label) => ({ label, sessions: buckets.get(label) ?? [] }))
    .filter((group) => group.sessions.length > 0);
}
