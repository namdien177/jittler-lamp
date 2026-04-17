import { describe, expect, test } from "bun:test";

import { createSessionArchive, createSessionDraft, sessionArchiveSchema, type SessionEvent } from "@jittle-lamp/shared";
import {
  applyArchiveToViewerCore,
  closeMergeDialog,
  createMergeGroup,
  createViewerCoreState,
  deriveSectionTimeline,
  getContiguousMergeableSelection,
  openMergeDialog,
  resetViewerCoreState,
  selectActionRange,
  selectSingleAction,
  toggleActionSelection,
  validateMergeDialog,
  type ViewerCoreState
} from "@jittle-lamp/viewer-core";

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

function makeMergeArchive() {
  return makeArchive([
    { at: NOW, payload: { kind: "lifecycle", phase: "recording", detail: "Started" } },
    { at: "2024-06-01T12:00:01.000Z", payload: { kind: "interaction", type: "click", selector: "#a" } },
    { at: "2024-06-01T12:00:02.000Z", payload: { kind: "interaction", type: "click", selector: "#b" } },
    { at: "2024-06-01T12:00:03.000Z", payload: { kind: "interaction", type: "click", selector: "#c" } },
    { at: "2024-06-01T12:00:04.000Z", payload: { kind: "interaction", type: "click", selector: "#d" } },
    {
      at: "2024-06-01T12:00:05.000Z",
      payload: {
        kind: "network",
        method: "GET",
        url: "https://example.com/api/users",
        subtype: "xhr",
        request: {
          headers: [{ name: "x-trace-id", value: "trace-123" }],
          cookies: []
        },
        response: {
          headers: [{ name: "content-type", value: "application/json" }],
          setCookieHeaders: [],
          setCookies: [],
          body: { disposition: "captured", value: "hello response", encoding: "utf8" }
        }
      }
    },
    {
      at: "2024-06-01T12:00:06.000Z",
      payload: {
        kind: "network",
        method: "GET",
        url: "https://example.com/assets/app.css",
        request: { headers: [], cookies: [] }
      }
    }
  ]);
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

describe("viewer core command helpers", () => {
  test("merge/unmerge commands are deterministic across dialog and group helpers", () => {
    const state = createViewerCoreState();
    const selection = ["action-1", "action-2", "action-3"];

    openMergeDialog(state, selection);
    expect(state.mergeDialogOpen).toBeTrue();
    expect(state.pendingMergeActionIds).toEqual(selection);

    state.mergeDialogValue = "  Grouped actions  ";
    const validation = validateMergeDialog(state);
    expect(validation).toEqual({
      ok: true,
      label: "Grouped actions",
      selectedActionIds: selection
    });

    if (!validation.ok) {
      throw new Error("expected merge validation to succeed");
    }

    const created = createMergeGroup({
      id: "merge-fixed",
      createdAt: NOW,
      label: validation.label,
      selectedActionIds: validation.selectedActionIds
    });
    const mergeGroups = [created, createMergeGroup({ id: "merge-keep", createdAt: NOW, label: "Keep", selectedActionIds: ["x", "y"] })];

    expect(created).toEqual({
      id: "merge-fixed",
      kind: "merge-group",
      memberIds: selection,
      tags: [],
      label: "Grouped actions",
      createdAt: NOW
    });

    const unmerged = mergeGroups.filter((group) => group.id !== "merge-fixed");
    expect(unmerged.map((group) => group.id)).toEqual(["merge-keep"]);

    closeMergeDialog(state);
    expect(state.mergeDialogOpen).toBeFalse();
    expect(state.pendingMergeActionIds).toEqual([]);
  });

  test("range and toggle selection commands mirror shift/cmd/ctrl variants", () => {
    const archive = makeMergeArchive();
    const actionIds = archive.sections.actions
      .filter((entry) => entry.payload.kind === "interaction")
      .map((entry) => entry.id);

    const cmdSelection = toggleActionSelection(selectSingleAction(actionIds[0]!), actionIds[2]!);
    expect([...cmdSelection.selectedActionIds]).toEqual([actionIds[0]!, actionIds[2]!]);
    expect(cmdSelection.anchorActionId).toBe(actionIds[2]!);

    const rangeFromCmdAnchor = selectActionRange(archive, [], cmdSelection, actionIds[3]!);
    expect([...rangeFromCmdAnchor.selectedActionIds]).toEqual([actionIds[2]!, actionIds[3]!]);
    expect(rangeFromCmdAnchor.anchorActionId).toBe(actionIds[2]!);

    const ctrlToggleOff = toggleActionSelection(rangeFromCmdAnchor, actionIds[3]!);
    expect([...ctrlToggleOff.selectedActionIds]).toEqual([actionIds[2]!]);
    expect(ctrlToggleOff.anchorActionId).toBe(actionIds[2]!);

    const shiftFromSingle = selectActionRange(archive, [], selectSingleAction(actionIds[1]!), actionIds[3]!);
    expect([...shiftFromSingle.selectedActionIds]).toEqual([actionIds[1]!, actionIds[2]!, actionIds[3]!]);
  });

  test("filter/search results remain consistent across repeated and equivalent queries", () => {
    const archive = makeMergeArchive();

    const first = deriveSectionTimeline(archive, "network", "all", "trace-123").map((item) => item.id);
    const second = deriveSectionTimeline(archive, "network", "all", "TRACE-123").map((item) => item.id);
    const regex = deriveSectionTimeline(archive, "network", "all", "/trace-\\d+/i").map((item) => item.id);
    const subtypeFiltered = deriveSectionTimeline(archive, "network", "xhr", "trace-123").map((item) => item.id);

    expect(first).toEqual(second);
    expect(first).toEqual(regex);
    expect(first).toEqual(subtypeFiltered);
    expect(deriveSectionTimeline(archive, "network", "all", "/(/invalid/").length).toBe(0);
  });

  test("mergeable selection contract matches parity constraints for merged and non-contiguous rows", () => {
    const archive = makeMergeArchive();
    const actionIds = archive.sections.actions
      .filter((entry) => entry.payload.kind === "interaction")
      .map((entry) => entry.id);

    const merged = createMergeGroup({
      id: "merge-middle",
      createdAt: NOW,
      label: "Middle",
      selectedActionIds: [actionIds[1]!, actionIds[2]!]
    });

    expect(getContiguousMergeableSelection(archive, [], [actionIds[0]!, actionIds[1]!, actionIds[2]!, actionIds[3]!])).toEqual(actionIds);
    expect(getContiguousMergeableSelection(archive, [], [actionIds[0]!, actionIds[3]!])).toEqual([]);
    expect(getContiguousMergeableSelection(archive, [merged], [actionIds[0]!, actionIds[3]!])).toEqual([]);
    expect(getContiguousMergeableSelection(archive, [merged], ["merge-middle", actionIds[3]!])).toEqual([]);
  });
});
