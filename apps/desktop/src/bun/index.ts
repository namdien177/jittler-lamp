import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";

import { loadResolvedCompanionConfig, saveCompanionConfig } from "../companion/config";
import { deleteSession, getCompanionConfigState, getCompanionRuntimeState, refreshCompanionConfig, registerMediaPlayback, startCompanionServer } from "../companion/server";
import { addSessionTag, getSessionNotes, listAllTags, loadLibrarySession, removeSessionTag, scanLibrarySessions, setSessionNotes } from "../companion/sessions-db";
import type { DesktopCompanionConfigSnapshot, DesktopCompanionRuntimeSnapshot, DesktopRPC } from "../rpc";
import { buildSessionZip, clearTempSession, importZipBundle, loadLocalSession } from "./zip-import";

let mainWindow: BrowserWindow<DesktopRPC> | null = null;

const rpc = BrowserView.defineRPC<DesktopRPC>({
  maxRequestTime: 10_000,
  handlers: {
    requests: {
      addSessionTag: async ({ sessionId, tag }) => {
        addSessionTag(sessionId, tag);
        return { ok: true as const };
      },
      chooseOutputDirectory: async ({ startingFolder }) => {
        const [selectedPath] = await Utils.openFileDialog({
          allowedFileTypes: "*",
          allowsMultipleSelection: false,
          canChooseDirectory: true,
          canChooseFiles: false,
          startingFolder
        });

        return {
          selectedPath: selectedPath ?? null
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
          process.exit(0);
        });

        return { ok: true as const };
      },
      getCompanionConfig: async () => toDesktopCompanionConfigSnapshot(await refreshCompanionConfig()),
      getCompanionRuntime: async () => toDesktopCompanionRuntimeSnapshot(await getCompanionRuntimeState()),
      getSessionNotes: async ({ sessionId }) => {
        return { notes: getSessionNotes(sessionId) };
      },
      getVideoPlaybackUrl: async ({ videoPath, mimeType }) => {
        return { url: registerMediaPlayback({ filePath: videoPath, mimeType }) };
      },
      exportSessionZip: async ({ sessionId }) => {
        const config = await getCompanionConfigState();
        const safeOutputDir = resolve(config.outputDir);
        const sessionFolder = resolve(join(safeOutputDir, sessionId));

        if (!sessionFolder.startsWith(safeOutputDir + "/") && sessionFolder !== safeOutputDir) {
          throw new Error("Invalid sessionId: path traversal detected.");
        }

        const zipBytes = await buildSessionZip(sessionFolder);

        const [saveDir] = await Utils.openFileDialog({
          allowedFileTypes: "*",
          allowsMultipleSelection: false,
          canChooseDirectory: true,
          canChooseFiles: false,
          startingFolder: homedir()
        });

        if (!saveDir) throw new Error("No save directory selected.");

        const savedPath = join(saveDir, `${sessionId}.zip`);
        await Bun.write(savedPath, zipBytes);

        return { savedPath };
      },
      importZipSession: async () => {
        const [selectedPath] = await Utils.openFileDialog({
          allowedFileTypes: "zip",
          allowsMultipleSelection: false,
          canChooseDirectory: false,
          canChooseFiles: true,
          startingFolder: homedir()
        });

        if (!selectedPath) throw new Error("No ZIP file selected.");

        const zipBytes = await Bun.file(selectedPath).bytes();
        return importZipBundle(zipBytes);
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
        const [selectedPath] = await Utils.openFileDialog({
          allowedFileTypes: "*",
          allowsMultipleSelection: false,
          canChooseDirectory: true,
          canChooseFiles: false,
          startingFolder: homedir()
        });

        if (!selectedPath) throw new Error("No folder selected.");

        return loadLocalSession(selectedPath);
      },
      openPath: async ({ path }) => {
        Utils.openPath(path);

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

        const nextConfig = toDesktopCompanionConfigSnapshot(await refreshCompanionConfig());

        return nextConfig;
      },
      setSessionNotes: async ({ sessionId, notes }) => {
        setSessionNotes(sessionId, notes);
        return { ok: true as const };
      }
    },
    messages: {}
  }
});

void startCompanionServer().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
});

mainWindow = new BrowserWindow({
  title: "jittle-lamp",
  rpc,
  url: "views://mainview/index.html",
  frame: {
    x: 120,
    y: 120,
    width: 1240,
    height: 840
  }
});

void mainWindow;

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
