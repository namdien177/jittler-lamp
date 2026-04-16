import { describe, expect, test } from "bun:test";

import type { SessionEvent } from "@jittle-lamp/shared";

import { buildTimeline, deriveAnchorMs, findActiveIndex, formatOffset } from "../apps/desktop/src/mainview/timeline";

const T0 = "2024-06-01T12:00:00.000Z";
const T1 = "2024-06-01T12:00:05.000Z";
const T2 = "2024-06-01T12:00:10.000Z";
const T3 = "2024-06-01T12:01:00.000Z";

function makeLifecycle(at: string, phase: "idle" | "armed" | "recording" | "processing" | "ready" | "failed", detail = "detail"): SessionEvent {
  return { at, payload: { kind: "lifecycle", phase, detail } };
}

function makeInteraction(at: string, type: "click" | "input" | "submit" | "navigation", selector?: string): SessionEvent {
  return { at, payload: { kind: "interaction", type, selector } };
}

function makeNetwork(at: string, method = "GET", url = "https://example.com/api"): SessionEvent {
  return {
    at,
    payload: {
      kind: "network",
      method,
      url,
      request: { headers: [], cookies: [] }
    }
  };
}

function makeConsole(at: string, message: string): SessionEvent {
  return { at, payload: { kind: "console", level: "info", message, args: [] } };
}

function makeError(at: string, message: string): SessionEvent {
  return { at, payload: { kind: "error", message, source: "page" } };
}

describe("deriveAnchorMs", () => {
  test("returns 0 for empty events", () => {
    expect(deriveAnchorMs([])).toBe(0);
  });

  test("uses first lifecycle recording phase as anchor", () => {
    const events = [
      makeLifecycle(T1, "armed"),
      makeLifecycle(T0, "recording"),
      makeLifecycle(T2, "ready")
    ];
    expect(deriveAnchorMs(events)).toBe(new Date(T0).getTime());
  });

  test("uses first recording phase even if not earliest event", () => {
    const events = [
      makeLifecycle(T0, "armed"),
      makeLifecycle(T1, "recording"),
      makeLifecycle(T2, "ready")
    ];
    expect(deriveAnchorMs(events)).toBe(new Date(T1).getTime());
  });

  test("falls back to earliest event when no recording phase", () => {
    const events = [
      makeLifecycle(T2, "ready"),
      makeLifecycle(T1, "armed"),
      makeLifecycle(T3, "failed")
    ];
    expect(deriveAnchorMs(events)).toBe(new Date(T1).getTime());
  });

  test("handles single event with no recording phase", () => {
    const events = [makeLifecycle(T2, "ready")];
    expect(deriveAnchorMs(events)).toBe(new Date(T2).getTime());
  });

  test("handles single recording event", () => {
    const events = [makeLifecycle(T1, "recording")];
    expect(deriveAnchorMs(events)).toBe(new Date(T1).getTime());
  });
});

describe("buildTimeline", () => {
  test("returns empty array for empty events", () => {
    expect(buildTimeline([])).toEqual([]);
  });

  test("assigns correct offsetMs relative to anchor", () => {
    const events = [
      makeLifecycle(T0, "recording"),
      makeLifecycle(T1, "ready")
    ];
    const items = buildTimeline(events);
    expect(items).toHaveLength(2);
    expect(items[0]!.offsetMs).toBe(0);
    expect(items[1]!.offsetMs).toBe(5000);
  });

  test("sorts items by offsetMs ascending", () => {
    const events = [
      makeLifecycle(T2, "ready"),
      makeLifecycle(T0, "recording"),
      makeLifecycle(T1, "processing")
    ];
    const items = buildTimeline(events);
    expect(items[0]!.offsetMs).toBe(0);
    expect(items[1]!.offsetMs).toBe(5000);
    expect(items[2]!.offsetMs).toBe(10000);
  });

  test("assigns kind=lifecycle for lifecycle events", () => {
    const items = buildTimeline([makeLifecycle(T0, "recording")]);
    expect(items[0]!.kind).toBe("lifecycle");
  });

  test("assigns kind=interaction for interaction events", () => {
    const items = buildTimeline([makeInteraction(T0, "click")]);
    expect(items[0]!.kind).toBe("interaction");
  });

  test("assigns kind=network for network events", () => {
    const items = buildTimeline([makeNetwork(T0)]);
    expect(items[0]!.kind).toBe("network");
  });

  test("assigns kind=console for console events", () => {
    const items = buildTimeline([makeConsole(T0, "hello")]);
    expect(items[0]!.kind).toBe("console");
  });

  test("assigns kind=error for error events", () => {
    const items = buildTimeline([makeError(T0, "oops")]);
    expect(items[0]!.kind).toBe("error");
  });

  test("lifecycle label is 'phase: detail'", () => {
    const items = buildTimeline([makeLifecycle(T0, "recording", "Started capture")]);
    expect(items[0]!.label).toBe("recording: Started capture");
  });

  test("interaction label with selector is 'type selector'", () => {
    const items = buildTimeline([makeInteraction(T0, "click", "#submit-btn")]);
    expect(items[0]!.label).toBe("click #submit-btn");
  });

  test("interaction label without selector is just type", () => {
    const items = buildTimeline([makeInteraction(T0, "navigation")]);
    expect(items[0]!.label).toBe("navigation");
  });

  test("network label is 'METHOD url'", () => {
    const items = buildTimeline([makeNetwork(T0, "POST", "https://api.example.com/data")]);
    expect(items[0]!.label).toBe("POST https://api.example.com/data");
  });

  test("console label is the message", () => {
    const items = buildTimeline([makeConsole(T0, "console output here")]);
    expect(items[0]!.label).toBe("console output here");
  });

  test("error label is the message", () => {
    const items = buildTimeline([makeError(T0, "TypeError: undefined")]);
    expect(items[0]!.label).toBe("TypeError: undefined");
  });

  test("events before anchor have negative offsetMs", () => {
    const events = [
      makeLifecycle(T1, "recording"),
      makeLifecycle(T0, "armed")
    ];
    const items = buildTimeline(events);
    const armedItem = items.find((i) => i.event.payload.kind === "lifecycle" && i.event.payload.phase === "armed");
    expect(armedItem!.offsetMs).toBe(-5000);
  });
});

describe("findActiveIndex", () => {
  const items = [
    { offsetMs: 0, event: makeLifecycle(T0, "recording"), kind: "lifecycle" as const, label: "recording: start" },
    { offsetMs: 5000, event: makeLifecycle(T1, "ready"), kind: "lifecycle" as const, label: "ready: done" },
    { offsetMs: 10000, event: makeLifecycle(T2, "failed"), kind: "lifecycle" as const, label: "failed: err" }
  ];

  test("returns -1 for empty items", () => {
    expect(findActiveIndex([], 5000)).toBe(-1);
  });

  test("returns -1 when currentTimeMs is before all items", () => {
    expect(findActiveIndex(items, -1000)).toBe(-1);
  });

  test("returns 0 at exact first item offset", () => {
    expect(findActiveIndex(items, 0)).toBe(0);
  });

  test("returns 0 when between first and second item", () => {
    expect(findActiveIndex(items, 2500)).toBe(0);
  });

  test("returns 1 at exact second item offset", () => {
    expect(findActiveIndex(items, 5000)).toBe(1);
  });

  test("returns last index when all items have passed", () => {
    expect(findActiveIndex(items, 99999)).toBe(2);
  });

  test("returns last index at exact last item offset", () => {
    expect(findActiveIndex(items, 10000)).toBe(2);
  });
});

describe("formatOffset", () => {
  test("formats 0ms as 00:00", () => {
    expect(formatOffset(0)).toBe("00:00");
  });

  test("formats 5000ms as 00:05", () => {
    expect(formatOffset(5000)).toBe("00:05");
  });

  test("formats 60000ms as 01:00", () => {
    expect(formatOffset(60000)).toBe("01:00");
  });

  test("formats 90000ms as 01:30", () => {
    expect(formatOffset(90000)).toBe("01:30");
  });

  test("formats 3600000ms as 60:00", () => {
    expect(formatOffset(3600000)).toBe("60:00");
  });

  test("formats negative values with leading minus", () => {
    expect(formatOffset(-5000)).toBe("-00:05");
  });

  test("formats -60000ms as -01:00", () => {
    expect(formatOffset(-60000)).toBe("-01:00");
  });

  test("truncates sub-second precision", () => {
    expect(formatOffset(5999)).toBe("00:05");
  });
});
