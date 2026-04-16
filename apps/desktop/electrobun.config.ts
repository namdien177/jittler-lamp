import { getWorkspaceVersion } from "../../scripts/release/workspace-version";

const workspaceVersion = getWorkspaceVersion();
const hasAppleApiKeyAuth = Boolean(
  process.env.ELECTROBUN_APPLEAPIKEYPATH &&
    process.env.ELECTROBUN_APPLEAPIKEY &&
    process.env.ELECTROBUN_APPLEAPIISSUER
);
const hasAppleIdAuth = Boolean(process.env.ELECTROBUN_APPLEID && process.env.ELECTROBUN_APPLEIDPASS);
const hasMacSigningCredentials = Boolean(
  process.env.ELECTROBUN_DEVELOPER_ID && process.env.ELECTROBUN_TEAMID && (hasAppleApiKeyAuth || hasAppleIdAuth)
);

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
      entrypoint: "src/bun/index.ts"
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/app.ts"
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
      notarize: hasMacSigningCredentials
    }
  }
};

export default config;
