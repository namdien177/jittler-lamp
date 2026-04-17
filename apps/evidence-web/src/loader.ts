import { unzipSync } from "fflate";
import {
  parseSessionArchiveJson,
  pickSessionBundleFiles,
  type ActionMergeGroup,
  type SessionArchive,
  type SessionLoader,
  type TimelineItem
} from "@jittle-lamp/shared";
import { deriveTimeline, getArchiveMergeGroups } from "@jittle-lamp/viewer-core";

export type LoadedSession = {
  archive: SessionArchive;
  videoUrl: string;
  recordingBytes: Uint8Array;
  timeline: TimelineItem[];
  mergeGroups: ActionMergeGroup[];
};

export class WebSessionZipLoader implements SessionLoader<File, LoadedSession> {
  async load(file: File): Promise<LoadedSession> {
    const buffer = await file.arrayBuffer();
    const files = unzipSync(new Uint8Array(buffer));
    const { archiveJson, recordingWebm } = pickSessionBundleFiles(files);

    const archive = parseSessionArchiveJson(archiveJson);

    const recordingArtifact = archive.artifacts.find((artifact) => artifact.kind === "recording.webm");
    const stableBuffer = Uint8Array.from(recordingWebm).buffer;
    const blob = new Blob([stableBuffer], { type: recordingArtifact?.mimeType || "video/webm" });
    const videoUrl = URL.createObjectURL(blob);

    return {
      archive,
      videoUrl,
      recordingBytes: Uint8Array.from(recordingWebm),
      timeline: deriveTimeline(archive),
      mergeGroups: getArchiveMergeGroups(archive)
    };
  }
}

export async function loadSessionZip(file: File): Promise<LoadedSession> {
  return new WebSessionZipLoader().load(file);
}
