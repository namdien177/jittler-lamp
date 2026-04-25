import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { getWorkspaceVersion, normalizeReleaseVersion, resolveRepoPath } from "./workspace-version";

const version = process.argv[2] ? normalizeReleaseVersion(process.argv[2]) : getWorkspaceVersion();
const artifactsPath = resolveRepoPath("apps", "desktop", "artifacts");
const releaseArtifactsPath = resolveRepoPath("release-artifacts");
const isSigned = process.env.JL_MACOS_SIGNED === "true";

if (!existsSync(artifactsPath)) {
  throw new Error(`Expected Electron artifacts directory at ${artifactsPath}`);
}

const artifactCandidates = readdirSync(artifactsPath, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((fileName) => fileName.startsWith("jittle-lamp-desktop-"))
  .filter((fileName) => fileName.endsWith(".dmg") || fileName.endsWith(".zip") || fileName.endsWith(".pkg"))
  .sort((left, right) => priority(left) - priority(right) || left.localeCompare(right));

const selectedArtifact = artifactCandidates[0];

if (!selectedArtifact) {
  throw new Error(`No macOS distribution artifact found in ${artifactsPath}`);
}

const artifactExtension = extname(selectedArtifact);
const releaseName = `jittle-lamp-desktop-v${version}-macos-arm64-${isSigned ? "signed" : "unsigned"}${artifactExtension}`;

mkdirSync(releaseArtifactsPath, { recursive: true });
copyFileSync(join(artifactsPath, selectedArtifact), join(releaseArtifactsPath, releaseName));

console.info(`Collected desktop release asset as ${join(releaseArtifactsPath, releaseName)}`);

function priority(fileName: string): number {
  if (fileName.endsWith(".dmg")) return 0;
  if (fileName.endsWith(".zip")) return 1;
  if (fileName.endsWith(".pkg")) return 2;
  return 99;
}
