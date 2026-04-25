import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
  type OpenDialogOptions
} from "electron";

import { loadResolvedCompanionConfig, saveCompanionConfig } from "../companion/config";
import {
  deleteSession,
  getCompanionConfigState,
  getCompanionRuntimeState,
  refreshCompanionConfig,
  registerMediaPlayback,
  startCompanionServer
} from "../companion/server";
import {
  addSessionTag,
  getSessionNotes,
  listAllTags,
  loadLibrarySession,
  removeSessionTag,
  saveLibrarySessionReviewState,
  scanLibrarySessions,
  setSessionNotes
} from "../companion/sessions-db";
import {
  desktopIpcMessageChannel,
  desktopIpcRequestChannel,
  type ContextMenuItem,
  type DesktopCompanionConfigSnapshot,
  type DesktopCompanionRuntimeSnapshot,
  type DesktopRendererMessageMap,
  type DesktopRequestMap
} from "../rpc";
import { buildSessionZip, clearTempSession, importZipBundle, loadLocalSession } from "../session/zip-import";

type DesktopHandler<K extends keyof DesktopRequestMap> = (
  params: DesktopRequestMap[K]["params"]
) => Promise<DesktopRequestMap[K]["response"]> | DesktopRequestMap[K]["response"];

type DesktopHandlerMap = {
  [K in keyof DesktopRequestMap]: DesktopHandler<K>;
};

type DesktopRequestPayload = {
  name?: string;
  params?: unknown;
};

type DesktopMessagePayload<K extends keyof DesktopRendererMessageMap = keyof DesktopRendererMessageMap> = {
  name: K;
  payload: DesktopRendererMessageMap[K];
};

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const preloadPath = join(currentDir, "preload.js");
const mainViewPath = join(currentDir, "..", "views", "mainview", "index.html");

let mainWindow: BrowserWindow | null = null;

const handlers: DesktopHandlerMap = {
  addSessionTag: async ({ sessionId, tag }) => {
    addSessionTag(sessionId, tag);
    return { ok: true as const };
  },
  chooseOutputDirectory: async ({ startingFolder }) => {
    const result = await showOpenDialog({
      defaultPath: startingFolder || homedir(),
      properties: ["openDirectory"]
    });

    return {
      selectedPath: result.canceled ? null : result.filePaths[0] ?? null
    };
  },
  clearTempSession: async ({ tempId }) => {
    await clearTempSession(tempId);
    return { ok: true as const };
  },
  deleteSession: async ({ sessionId }) => {
    await deleteSession(sessionId);
    return { ok: true as const };
  },
  exitApp: async () => {
    queueMicrotask(() => {
      app.quit();
    });

    return { ok: true as const };
  },
  exportSessionZip: async ({ sessionId }) => {
    const config = await getCompanionConfigState();
    const safeOutputDir = resolve(config.outputDir);
    const sessionFolder = resolve(join(safeOutputDir, sessionId));

    if (!sessionFolder.startsWith(`${safeOutputDir}/`) && sessionFolder !== safeOutputDir) {
      throw new Error("Invalid sessionId: path traversal detected.");
    }

    const zipBytes = await buildSessionZip(sessionFolder);
    const result = await showOpenDialog({
      defaultPath: homedir(),
      properties: ["openDirectory"]
    });

    const saveDir = result.canceled ? null : result.filePaths[0] ?? null;
    if (!saveDir) throw new Error("No save directory selected.");

    const savedPath = join(saveDir, `${sessionId}.zip`);
    await writeFile(savedPath, zipBytes);

    return { savedPath };
  },
  getCompanionConfig: async () => toDesktopCompanionConfigSnapshot(await refreshCompanionConfig()),
  getCompanionRuntime: async () => toDesktopCompanionRuntimeSnapshot(await getCompanionRuntimeState()),
  getSessionNotes: async ({ sessionId }) => {
    return { notes: getSessionNotes(sessionId) };
  },
  getVideoPlaybackUrl: async ({ videoPath, mimeType }) => {
    return { url: registerMediaPlayback({ filePath: videoPath, mimeType }) };
  },
  importZipSession: async () => {
    const result = await showOpenDialog({
      defaultPath: homedir(),
      filters: [{ name: "ZIP archives", extensions: ["zip"] }],
      properties: ["openFile"]
    });

    const selectedPath = result.canceled ? null : result.filePaths[0] ?? null;
    if (!selectedPath) throw new Error("No ZIP file selected.");

    return importZipBundle(new Uint8Array(await readFile(selectedPath)));
  },
  listAllTags: async () => listAllTags(),
  listSessions: async () => {
    const config = await getCompanionConfigState();
    return scanLibrarySessions(config.outputDir);
  },
  loadLibrarySession: async ({ sessionId }) => {
    const config = await getCompanionConfigState();
    return loadLibrarySession(sessionId, config.outputDir);
  },
  openLocalSession: async () => {
    const result = await showOpenDialog({
      defaultPath: homedir(),
      properties: ["openDirectory"]
    });

    const selectedPath = result.canceled ? null : result.filePaths[0] ?? null;
    if (!selectedPath) throw new Error("No folder selected.");

    return loadLocalSession(selectedPath);
  },
  openPath: async ({ path }) => {
    const openError = await shell.openPath(path);
    if (openError) {
      throw new Error(openError);
    }

    return {
      ok: true as const
    };
  },
  removeSessionTag: async ({ sessionId, tag }) => {
    removeSessionTag(sessionId, tag);
    return { ok: true as const };
  },
  saveOutputDirectory: async ({ outputDir }) => {
    const currentConfig = await loadResolvedCompanionConfig();

    if (currentConfig.envOverrideActive) {
      throw new Error(
        "JITTLE_LAMP_OUTPUT_DIR is set. Remove the environment override before editing the saved output folder."
      );
    }

    await saveCompanionConfig({ outputDir });

    return toDesktopCompanionConfigSnapshot(await refreshCompanionConfig());
  },
  saveSessionReviewState: async ({ sessionId, notes, annotations }) => {
    const config = await getCompanionConfigState();
    const archive = await saveLibrarySessionReviewState({
      sessionId,
      outputDir: config.outputDir,
      notes,
      annotations
    });
    return { ok: true as const, archive };
  },
  setSessionNotes: async ({ sessionId, notes }) => {
    setSessionNotes(sessionId, notes);
    return { ok: true as const };
  },
  showContextMenu: async ({ menu }) => {
    showContextMenu(menu);
    return { ok: true as const };
  }
};

app.setName("Jittle Lamp");
registerIpcHandlers();

void app.whenReady().then(async () => {
  await startCompanionServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerIpcHandlers(): void {
  ipcMain.handle(desktopIpcRequestChannel, async (_event, payload: DesktopRequestPayload) => {
    if (!payload.name || !(payload.name in handlers)) {
      throw new Error(`Unknown desktop request: ${payload.name ?? "(missing)"}`);
    }

    const name = payload.name as keyof DesktopRequestMap;
    const handler = handlers[name] as DesktopHandler<typeof name>;
    return handler(payload.params as never);
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    title: "Jittle Lamp",
    x: 120,
    y: 120,
    width: 1240,
    height: 840,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: false
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadFile(mainViewPath);
}

function showOpenDialog(options: OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  if (mainWindow) {
    return dialog.showOpenDialog(mainWindow, options);
  }

  return dialog.showOpenDialog(options);
}

function showContextMenu(menu: ContextMenuItem[]): void {
  const template = menu.flatMap((item): MenuItemConstructorOptions[] => {
    if (item.type === "separator") {
      return [{ type: "separator" }];
    }

    if (!item.label) {
      return [];
    }

    const menuItem: MenuItemConstructorOptions = {
      label: item.label,
      type: "normal",
      click: () => {
        if (item.action) {
          sendRendererMessage("contextMenuClicked", {
            action: item.action,
            data: item.data
          });
        }
      }
    };

    if (item.enabled !== undefined) {
      menuItem.enabled = item.enabled;
    }

    return [menuItem];
  });

  if (mainWindow) {
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
    return;
  }

  Menu.buildFromTemplate(template).popup();
}

function sendRendererMessage<K extends keyof DesktopRendererMessageMap>(
  name: K,
  payload: DesktopRendererMessageMap[K]
): void {
  const message: DesktopMessagePayload<K> = {
    name,
    payload
  };

  mainWindow?.webContents.send(desktopIpcMessageChannel, message);
}

function toDesktopCompanionConfigSnapshot(config: Awaited<ReturnType<typeof loadResolvedCompanionConfig>>): DesktopCompanionConfigSnapshot {
  return {
    configFilePath: config.configFilePath,
    defaultOutputDir: config.defaultOutputDir,
    envOverrideActive: config.envOverrideActive,
    outputDir: config.outputDir,
    savedOutputDir: config.savedOutputDir,
    source: config.source
  };
}

function toDesktopCompanionRuntimeSnapshot(
  runtime: Awaited<ReturnType<typeof getCompanionRuntimeState>>
): DesktopCompanionRuntimeSnapshot {
  return {
    status: runtime.status,
    origin: runtime.origin,
    outputDir: runtime.outputDir,
    lastError: runtime.lastError,
    recentWrites: runtime.recentWrites
  };
}
