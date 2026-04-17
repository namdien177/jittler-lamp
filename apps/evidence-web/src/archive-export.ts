import { zipSync } from "fflate";

import {
  recordingFileName,
  sessionArchiveFileName,
  sessionArchiveSchema,
  type ActionMergeGroup,
  type SessionArchive,
  type SessionExporter
} from "@jittle-lamp/shared";

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

export type ReviewedSessionZipInput = {
  archive: SessionArchive;
  mergeGroups: ActionMergeGroup[];
  recordingBytes: Uint8Array;
  now?: Date;
};

export class WebReviewedSessionZipExporter implements SessionExporter<ReviewedSessionZipInput, Uint8Array> {
  export(input: ReviewedSessionZipInput): Uint8Array {
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
      [sessionArchiveFileName]: new TextEncoder().encode(`${JSON.stringify(archive, null, 2)}\n`),
      [recordingFileName]: Uint8Array.from(input.recordingBytes)
    });
  }
}

export function buildReviewedSessionZip(input: ReviewedSessionZipInput): Uint8Array {
  return new WebReviewedSessionZipExporter().export(input);
}
