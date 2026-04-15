import type { RPCSchema } from "electrobun/bun";

import type { ResolvedCompanionConfig } from "./companion/config";
import type { CompanionArtifactWrite, CompanionRuntimeState } from "./companion/server";

export type DesktopCompanionConfigSnapshot = Pick<
  ResolvedCompanionConfig,
  "configFilePath" | "defaultOutputDir" | "envOverrideActive" | "outputDir" | "savedOutputDir" | "source"
>;

export type DesktopCompanionRuntimeSnapshot = Pick<CompanionRuntimeState, "lastError" | "origin" | "outputDir" | "status"> & {
  recentWrites: CompanionArtifactWrite[];
};

export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      chooseOutputDirectory: {
        params: {
          startingFolder: string;
        };
        response: {
          selectedPath: string | null;
        };
      };
      getCompanionConfig: {
        params: undefined;
        response: DesktopCompanionConfigSnapshot;
      };
      getCompanionRuntime: {
        params: undefined;
        response: DesktopCompanionRuntimeSnapshot;
      };
      openPath: {
        params: {
          path: string;
        };
        response: {
          ok: true;
        };
      };
      saveOutputDirectory: {
        params: {
          outputDir: string;
        };
        response: DesktopCompanionConfigSnapshot;
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {};
  }>;
};
