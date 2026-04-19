import { Electroview } from "electrobun/view";

import type { ContextMenuItem, DesktopRPC } from "../rpc";

export type DesktopBridge = {
  rpc: {
    request: {
      addSessionTag(params: { sessionId: string; tag: string }): Promise<{ ok: true }>;
      chooseOutputDirectory(params: { startingFolder: string }): Promise<{ selectedPath: string | null }>;
      clearTempSession(params: { tempId: string }): Promise<{ ok: true }>;
      deleteSession(params: { sessionId: string }): Promise<{ ok: true }>;
      exitApp(params: undefined): Promise<{ ok: true }>;
      getCompanionConfig(params: undefined): Promise<import("../rpc").DesktopCompanionConfigSnapshot>;
      getCompanionRuntime(params: undefined): Promise<import("../rpc").DesktopCompanionRuntimeSnapshot>;
      exportSessionZip(params: { sessionId: string }): Promise<{ savedPath: string }>;
      getVideoPlaybackUrl(params: { videoPath: string; mimeType: string }): Promise<{ url: string }>;
      importZipSession(params: undefined): Promise<import("../rpc").ViewerPayload>;
      listAllTags(params: undefined): Promise<string[]>;
      openLocalSession(params: undefined): Promise<import("../rpc").ViewerPayload>;
      listSessions(params: undefined): Promise<import("../rpc").SessionRecord[]>;
      loadLibrarySession(params: { sessionId: string }): Promise<import("../rpc").ViewerPayload>;
      openPath(params: { path: string }): Promise<{ ok: true }>;
      removeSessionTag(params: { sessionId: string; tag: string }): Promise<{ ok: true }>;
      saveOutputDirectory(params: { outputDir: string }): Promise<import("../rpc").DesktopCompanionConfigSnapshot>;
      setSessionNotes(params: { sessionId: string; notes: string }): Promise<{ ok: true }>;
      saveSessionReviewState(params: { sessionId: string; notes: string; annotations: import("@jittle-lamp/shared").ArchiveAnnotation[] }): Promise<{ ok: true; archive: import("../rpc").ViewerPayload["archive"] }>;
      showContextMenu(params: { menu: ContextMenuItem[] }): Promise<{ ok: true }>;
    };
  };
  onContextMenuClicked: (handler: (data: { action: string; data?: unknown }) => void) => void;
};

export function createDesktopBridge(): DesktopBridge | null {
  let contextMenuHandler: ((data: { action: string; data?: unknown }) => void) | null = null;

  try {
    const rpc = Electroview.defineRPC<DesktopRPC>({
      maxRequestTime: 10_000,
      handlers: {
        requests: {},
        messages: {
          contextMenuClicked: (data) => {
            contextMenuHandler?.(data);
          }
        }
      }
    });

    new Electroview({ rpc });

    return {
      rpc: {
        request: rpc.request as DesktopBridge["rpc"]["request"]
      },
      onContextMenuClicked: (handler) => {
        contextMenuHandler = handler;
      }
    };
  } catch {
    return null;
  }
}
