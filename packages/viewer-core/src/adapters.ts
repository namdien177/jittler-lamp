import type { ArchiveAnnotation, SessionArchive } from "@jittle-lamp/shared";

export interface StorageAdapter<TSessionPayload> {
  loadFromZipFile?(file: File): Promise<TSessionPayload>;
  importZipSession?(): Promise<TSessionPayload>;
  openLocalSession?(): Promise<TSessionPayload>;
  loadLibrarySession?(sessionId: string): Promise<TSessionPayload>;
  saveSessionReviewState?(args: {
    sessionId: string;
    notes: string;
    annotations: ArchiveAnnotation[];
  }): Promise<{ archive: SessionArchive }>;
  exportSessionZip?(sessionId: string): Promise<{ savedPath: string }>;
}

export interface PlaybackAdapter {
  loadSource(args: {
    videoPath: string;
    mimeType: string;
    onBridgeUnavailable?: () => void;
    onLoadFailure?: (error: unknown, diagnostics: unknown) => void;
  }): void;
  releaseSource?(): void;
}

export interface ShareAdapter {
  createShareLink?(args: { sessionId: string }): Promise<{ url: string }>;
  revokeShareLink?(args: { sessionId: string }): Promise<{ ok: true }>;
}

export interface NotesAdapter<Source extends string> {
  canEdit(source: Source): boolean;
  getReadOnlyNotice(source: Source): string | null;
}

export type ViewerAdapters<TSessionPayload, Source extends string = string> = {
  storage: StorageAdapter<TSessionPayload>;
  playback: PlaybackAdapter;
  share: ShareAdapter;
  notes: NotesAdapter<Source>;
};
