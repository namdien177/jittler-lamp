import { unzipSync } from "fflate";
import { sessionArchiveSchema, type ActionMergeGroup, type SessionArchive, type TimelineItem } from "@jittle-lamp/shared";
import { deriveTimeline, getArchiveMergeGroups } from "@jittle-lamp/viewer-core";

export type LoadedSession = {
  archive: SessionArchive;
  videoUrl: string;
  recordingBytes: Uint8Array;
  timeline: TimelineItem[];
  mergeGroups: ActionMergeGroup[];
};

export async function loadSessionZip(file: File): Promise<LoadedSession> {
  const buffer = await file.arrayBuffer();
  const files = unzipSync(new Uint8Array(buffer));

  let webmData: Uint8Array | null = null;
  let jsonData: Uint8Array | null = null;

  for (const [path, content] of Object.entries(files)) {
    const name = path.split("/").pop();
    if (name === "recording.webm") webmData = content;
    if (name === "session.archive.json") jsonData = content;
  }

  if (!jsonData) throw new Error("session.archive.json not found in ZIP.");
  if (!webmData) throw new Error("recording.webm not found in ZIP.");

  const text = new TextDecoder().decode(jsonData);
  const archive = sessionArchiveSchema.parse(JSON.parse(text));

  const recordingArtifact = archive.artifacts.find((artifact) => artifact.kind === "recording.webm");
  const stableBuffer = Uint8Array.from(webmData).buffer;
  const blob = new Blob([stableBuffer], { type: recordingArtifact?.mimeType || "video/webm" });
  const videoUrl = URL.createObjectURL(blob);

  return {
    archive,
    videoUrl,
    recordingBytes: Uint8Array.from(webmData),
    timeline: deriveTimeline(archive),
    mergeGroups: getArchiveMergeGroups(archive)
  };
}
