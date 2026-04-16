import type { CaptureSessionDraft } from "@jittle-lamp/shared";

export const defaultDraftStorageBudgetBytes = 256 * 1024;

export function estimateSerializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function createDraftStorageCheckpoint(
  draft: CaptureSessionDraft,
  maxBytes: number = defaultDraftStorageBudgetBytes
): CaptureSessionDraft {
  if (estimateSerializedBytes(draft) <= maxBytes) {
    return draft;
  }

  const selectedIndices = collectAnchorEventIndices(draft);
  let bestCheckpoint = checkpointFromIndices(draft, selectedIndices);

  if (estimateSerializedBytes(bestCheckpoint) > maxBytes) {
    bestCheckpoint = reduceAnchorEventsToFit(draft, selectedIndices, maxBytes);
  } else {
    const growingSelection = new Set(selectedIndices);

    for (let index = draft.events.length - 1; index >= 0; index -= 1) {
      if (growingSelection.has(index)) {
        continue;
      }

      growingSelection.add(index);
      const candidate = checkpointFromIndices(draft, Array.from(growingSelection));

      if (estimateSerializedBytes(candidate) <= maxBytes) {
        bestCheckpoint = candidate;
        continue;
      }

      growingSelection.delete(index);
      break;
    }
  }

  if (estimateSerializedBytes(bestCheckpoint) <= maxBytes) {
    return bestCheckpoint;
  }

  const latestEvent = draft.events.at(-1);

  return {
    ...draft,
    events: latestEvent ? [latestEvent] : []
  };
}

function collectAnchorEventIndices(draft: CaptureSessionDraft): number[] {
  const selected = new Set<number>();

  if (draft.events.length > 0) {
    selected.add(0);
  }

  for (let index = 0; index < draft.events.length; index += 1) {
    const payload = draft.events[index]?.payload;

    if (payload?.kind === "lifecycle" && (payload.phase === "armed" || payload.phase === "recording")) {
      selected.add(index);
    }
  }

  return Array.from(selected).sort((a, b) => a - b);
}

function reduceAnchorEventsToFit(
  draft: CaptureSessionDraft,
  anchorIndices: number[],
  maxBytes: number
): CaptureSessionDraft {
  const reduced = [...anchorIndices];

  while (reduced.length > 1) {
    reduced.shift();
    const checkpoint = checkpointFromIndices(draft, reduced);

    if (estimateSerializedBytes(checkpoint) <= maxBytes) {
      return checkpoint;
    }
  }

  return checkpointFromIndices(draft, reduced);
}

function checkpointFromIndices(draft: CaptureSessionDraft, indices: number[]): CaptureSessionDraft {
  const orderedIndices = Array.from(new Set(indices)).sort((a, b) => a - b);

  return {
    ...draft,
    events: orderedIndices
      .map((index) => draft.events[index])
      .filter((event): event is CaptureSessionDraft["events"][number] => event !== undefined)
  };
}
