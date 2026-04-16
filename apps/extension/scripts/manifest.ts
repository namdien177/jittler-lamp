import { getWorkspaceVersion } from "../../../scripts/release/workspace-version";

export const extensionManifest = {
  manifest_version: 3,
  name: "jittle-lamp",
  version: getWorkspaceVersion(),
  description: "Local-first active-tab recorder for Chromium browser sessions.",
  minimum_chrome_version: "123",
  action: {
    default_title: "jittle-lamp",
    default_popup: "popup.html"
  },
  background: {
    service_worker: "background.js",
    type: "module"
  },
  permissions: [
    "activeTab",
    "scripting",
    "storage",
    "downloads",
    "tabCapture",
    "debugger",
    "offscreen"
  ],
  host_permissions: ["http://127.0.0.1/*"],
  optional_host_permissions: ["<all_urls>"]
} satisfies chrome.runtime.ManifestV3;
