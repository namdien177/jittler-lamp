import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { zipSync } from "fflate";

import { getWorkspaceVersion, normalizeReleaseVersion, resolveRepoPath } from "./workspace-version";

const version = process.argv[2] ? normalizeReleaseVersion(process.argv[2]) : getWorkspaceVersion();
const extensionDistPath = resolveRepoPath("apps", "extension", "dist");
const releaseArtifactsPath = resolveRepoPath("release-artifacts");
const outputPath = join(releaseArtifactsPath, `jittle-lamp-extension-v${version}.zip`);

const zipEntries: Record<string, Uint8Array> = {};

collectFiles(extensionDistPath);

if (!("manifest.json" in zipEntries)) {
  throw new Error(`Expected ${extensionDistPath} to contain manifest.json before packaging the extension.`);
}

mkdirSync(releaseArtifactsPath, { recursive: true });
writeFileSync(outputPath, zipSync(zipEntries, { level: 9 }));

console.info(`Packaged extension release asset at ${outputPath}`);

function collectFiles(currentPath: string): void {
  const directoryEntries = readdirSync(currentPath, { withFileTypes: true });

  for (const directoryEntry of directoryEntries) {
    const absolutePath = join(currentPath, directoryEntry.name);

    if (directoryEntry.isDirectory()) {
      collectFiles(absolutePath);
      continue;
    }

    if (!directoryEntry.isFile()) {
      continue;
    }

    const stats = statSync(absolutePath);

    if (!stats.isFile()) {
      continue;
    }

    zipEntries[relative(extensionDistPath, absolutePath)] = new Uint8Array(readFileSync(absolutePath));
  }
}
