import type { RPCSchema } from "electrobun/bun";

import type { ResolvedCompanionConfig } from "./companion/config";

export type DesktopCompanionConfigSnapshot = Pick<
  ResolvedCompanionConfig,
  "configFilePath" | "defaultOutputDir" | "envOverrideActive" | "outputDir" | "savedOutputDir" | "source"
>;

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
