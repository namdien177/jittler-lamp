import { zipSync } from "fflate";

import { sessionArchiveSchema } from "@jittle-lamp/shared";
import type { ActionMergeGroup, SessionArchive } from "@jittle-lamp/shared";

export function buildReviewedArchive(input: {
  archive: SessionArchive;
  mergeGroups: ActionMergeGroup[];
  now?: Date;
}): SessionArchive {
  return sessionArchiveSchema.parse({
    ...input.archive,
    updatedAt: (input.now ?? new Date()).toISOString(),
    annotations: input.mergeGroups
  });
}

export function buildReviewedSessionZip(input: {
  archive: SessionArchive;
  mergeGroups: ActionMergeGroup[];
  recordingBytes: Uint8Array;
  now?: Date;
}): Uint8Array {
  const archive = buildReviewedArchive(
    input.now
      ? {
          archive: input.archive,
          mergeGroups: input.mergeGroups,
          now: input.now
        }
      : {
          archive: input.archive,
          mergeGroups: input.mergeGroups
        }
  );

  return zipSync({
    "session.archive.json": new TextEncoder().encode(`${JSON.stringify(archive, null, 2)}\n`),
    "recording.webm": Uint8Array.from(input.recordingBytes)
  });
}
