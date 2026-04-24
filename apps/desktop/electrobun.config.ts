import { getWorkspaceVersion } from "../../scripts/release/workspace-version";

const workspaceVersion = getWorkspaceVersion();
const workspaceRoot = new URL("../../", import.meta.url);
const cliBuildEnv = process.argv.find((arg) => arg.startsWith("--env="))?.split("=")[1];
const requestedBuildEnv = process.env.ELECTROBUN_BUILD_ENV ?? cliBuildEnv ?? "dev";
const buildEnv = ["dev", "canary", "stable"].includes(requestedBuildEnv) ? requestedBuildEnv : "dev";
const isDevelopmentBuild = buildEnv === "dev";
const nodeEnv = isDevelopmentBuild ? "development" : "production";
const reactEntrypoints = new Map([
  ["react", new URL("node_modules/react/index.js", workspaceRoot).pathname],
  ["react/jsx-runtime", new URL("node_modules/react/jsx-runtime.js", workspaceRoot).pathname],
  ["react/jsx-dev-runtime", new URL("node_modules/react/jsx-dev-runtime.js", workspaceRoot).pathname],
  ["react-dom", new URL("node_modules/react-dom/index.js", workspaceRoot).pathname],
  ["react-dom/client", new URL("node_modules/react-dom/client.js", workspaceRoot).pathname]
]);
const dedupeReactPlugin = {
  name: "dedupe-react",
  setup(build: {
    onResolve: (
      options: { filter: RegExp },
      callback: (args: { path: string }) => { path: string } | undefined
    ) => void;
  }) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime|\/jsx-dev-runtime)?$|^react-dom(?:\/client)?$/ }, (args) => {
      const path = reactEntrypoints.get(args.path);
      return path ? { path } : undefined;
    });
  }
};
const hasAppleApiKeyAuth = Boolean(
  process.env.ELECTROBUN_APPLEAPIKEYPATH &&
    process.env.ELECTROBUN_APPLEAPIKEY &&
    process.env.ELECTROBUN_APPLEAPIISSUER
);
const hasAppleIdAuth = Boolean(process.env.ELECTROBUN_APPLEID && process.env.ELECTROBUN_APPLEIDPASS);
const hasMacSigningCredentials = Boolean(
  process.env.ELECTROBUN_DEVELOPER_ID && process.env.ELECTROBUN_TEAMID && (hasAppleApiKeyAuth || hasAppleIdAuth)
);

const useCEF = isDevelopmentBuild;

const config = {
  app: {
    name: "Jittle Lamp",
    identifier: "dev.jittlelamp.desktop",
    version: workspaceVersion
  },
  build: {
    buildFolder: "build",
    artifactFolder: "artifacts",
    bun: {
      entrypoint: "src/bun/index.ts",
      define: {
        "process.env.NODE_ENV": JSON.stringify(nodeEnv)
      },
      minify: !isDevelopmentBuild
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/app.tsx",
        define: {
          "process.env.NODE_ENV": JSON.stringify(nodeEnv)
        },
        minify: !isDevelopmentBuild,
        plugins: [dedupeReactPlugin]
      }
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/index.css": "views/mainview/index.css"
    },
    mac: {
      target: "dmg",
      category: "public.app-category.productivity",
      codesign: hasMacSigningCredentials,
      notarize: hasMacSigningCredentials,
      bundleCEF: useCEF,
      defaultRenderer: useCEF ? "cef" : "native"
    }
  }
};

export default config;
