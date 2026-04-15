import { BrowserView, BrowserWindow, Utils } from "electrobun/bun";

import { loadResolvedCompanionConfig, saveCompanionConfig } from "../companion/config";
import { getCompanionRuntimeState, refreshCompanionConfig, startCompanionServer } from "../companion/server";
import type { DesktopCompanionConfigSnapshot, DesktopCompanionRuntimeSnapshot, DesktopRPC } from "../rpc";

let mainWindow: BrowserWindow<DesktopRPC> | null = null;

const rpc = BrowserView.defineRPC<DesktopRPC>({
  maxRequestTime: 10_000,
  handlers: {
    requests: {
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
      getCompanionConfig: async () => toDesktopCompanionConfigSnapshot(await refreshCompanionConfig()),
      getCompanionRuntime: async () => toDesktopCompanionRuntimeSnapshot(await getCompanionRuntimeState()),
      openPath: async ({ path }) => {
        Utils.openPath(path);

        return {
          ok: true as const
        };
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
