import type { SessionEvent } from "@jittle-lamp/shared";

export type TimelineKind = "lifecycle" | "interaction" | "network" | "console" | "error";

export type TimelineItem = {
  offsetMs: number;
  event: SessionEvent;
  kind: TimelineKind;
  label: string;
};

export function deriveAnchorMs(events: ReadonlyArray<SessionEvent>): number {
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

export function buildTimeline(events: ReadonlyArray<SessionEvent>): TimelineItem[] {
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

export function findActiveIndex(items: ReadonlyArray<TimelineItem>, currentTimeMs: number): number {
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

export function formatOffset(offsetMs: number): string {
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
