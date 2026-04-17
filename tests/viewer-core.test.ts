import { describe, expect, test } from "bun:test";

import { applyArchiveToViewerCore, createSessionArchive, createSessionDraft, createViewerCoreState, resetViewerCoreState, sessionArchiveSchema, type ViewerCoreState, type SessionEvent } from "@jittle-lamp/shared";

const NOW = "2024-06-01T12:00:00.000Z";

function makeArchive(events: SessionEvent[]) {
  const draft = createSessionDraft({
    page: { title: "Example", url: "https://example.com" },
    now: new Date(NOW)
  });

  return createSessionArchive({
    ...draft,
    createdAt: NOW,
    updatedAt: events.at(-1)?.at ?? NOW,
    phase: "ready",
    events
  });
}

function makeAnnotatedArchive(events: SessionEvent[]) {
  const archive = makeArchive(events);

  return sessionArchiveSchema.parse({
    ...archive,
    annotations: [
      {
        id: "merge-1",
        kind: "merge-group",
        memberIds: [archive.sessionId + ":actions:000001", archive.sessionId + ":actions:000002"],
        tags: [],
        label: "Merged",
        createdAt: NOW
      }
    ]
  });
}

function mutateCoreState(state: ViewerCoreState): void {
  state.activeIndex = 10;
  state.networkDetailIndex = 4;
  state.networkSearchQuery = "hello";
  state.mergeDialogOpen = true;
  state.mergeDialogValue = "Merged stuff";
  state.mergeDialogError = "Oops";
  state.pendingMergeActionIds = ["a", "b"];
  state.activeSection = "network";
  state.networkSubtypeFilter = "xhr";
  state.autoFollow = false;
  state.selectedActionIds = new Set(["a"]);
  state.anchorActionId = "a";
  state.mergeGroups = [
    {
      id: "merge-x",
      kind: "merge-group",
      memberIds: ["a", "b"],
      tags: [],
      label: "X",
      createdAt: NOW
    }
  ];
}

describe("viewer core state helpers", () => {
  test("createViewerCoreState returns default viewer state", () => {
    const state = createViewerCoreState();

    expect(state.activeIndex).toBe(-1);
    expect(state.networkDetailIndex).toBeNull();
    expect(state.networkSearchQuery).toBe("");
    expect(state.activeSection).toBe("actions");
    expect(state.networkSubtypeFilter).toBe("all");
    expect(state.autoFollow).toBe(true);
    expect(state.selectedActionIds.size).toBe(0);
    expect(state.mergeGroups).toEqual([]);
  });

  test("resetViewerCoreState clears viewer interaction state", () => {
    const state = createViewerCoreState();
    mutateCoreState(state);

    resetViewerCoreState(state);

    expect(state.activeIndex).toBe(-1);
    expect(state.networkDetailIndex).toBeNull();
    expect(state.networkSearchQuery).toBe("");
    expect(state.mergeDialogOpen).toBe(false);
    expect(state.mergeDialogValue).toBe("");
    expect(state.mergeDialogError).toBeNull();
    expect(state.pendingMergeActionIds).toEqual([]);
    expect(state.activeSection).toBe("actions");
    expect(state.networkSubtypeFilter).toBe("all");
    expect(state.autoFollow).toBe(true);
    expect(state.selectedActionIds.size).toBe(0);
    expect(state.anchorActionId).toBeNull();
    expect(state.mergeGroups).toEqual([]);
  });

  test("applyArchiveToViewerCore hydrates timeline and merge groups", () => {
    const state = createViewerCoreState();
    mutateCoreState(state);
    const archive = makeAnnotatedArchive([
      { at: NOW, payload: { kind: "lifecycle", phase: "recording", detail: "Started" } },
      { at: "2024-06-01T12:00:01.000Z", payload: { kind: "interaction", type: "click", selector: "#a" } },
      { at: "2024-06-01T12:00:02.000Z", payload: { kind: "interaction", type: "click", selector: "#b" } }
    ]);

    applyArchiveToViewerCore(state, archive);

    expect(state.timeline.length).toBeGreaterThan(0);
    expect(state.activeIndex).toBe(-1);
    expect(state.networkDetailIndex).toBeNull();
    expect(state.networkSearchQuery).toBe("");
    expect(state.mergeDialogOpen).toBe(false);
    expect(state.pendingMergeActionIds).toEqual([]);
    expect(state.activeSection).toBe("actions");
    expect(state.networkSubtypeFilter).toBe("all");
    expect(state.autoFollow).toBe(true);
    expect(state.selectedActionIds.size).toBe(0);
    expect(state.anchorActionId).toBeNull();
    expect(state.mergeGroups).toHaveLength(1);
    expect(state.mergeGroups[0]?.id).toBe("merge-1");
  });
});
