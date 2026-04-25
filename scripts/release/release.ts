import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
  getWorkspaceVersion,
  normalizeReleaseVersion,
  resolveRepoPath,
  versionPackageRelativePaths
} from "./workspace-version";

const rawVersion = process.argv[2];

if (!rawVersion) {
  console.error("Usage: bun run release <version>");
  process.exit(1);
}

const nextVersion = normalizeReleaseVersion(rawVersion);
const currentVersion = getWorkspaceVersion();
const tagName = `v${nextVersion}`;

if (nextVersion === currentVersion) {
  fail(`Workspace is already at ${nextVersion}.`);
}

assertCleanWorkingTree();
assertMainBranch();

run("git", ["fetch", "origin", "main", "--tags"]);
assertMainMatchesOrigin();
assertTagDoesNotExist(tagName);

run("bun", ["run", "release:set-version", nextVersion]);
run("bun", ["install"]);
run("bun", ["run", "release:check-version", tagName]);

const releaseFiles = [...versionPackageRelativePaths, "bun.lock"].filter((relativePath) =>
  existsSync(resolveRepoPath(relativePath))
);

run("git", ["add", ...releaseFiles]);

if (!hasStagedChanges()) {
  fail("Release version bump did not create any staged changes.");
}

run("git", ["commit", "-m", `release: ${tagName}`]);
run("git", ["push", "origin", "main"]);
run("git", ["tag", tagName]);
run("git", ["push", "origin", tagName]);

console.info(`Created and pushed ${tagName}. The release workflow will build and publish the GitHub release.`);

function assertCleanWorkingTree(): void {
  const status = capture("git", ["status", "--porcelain"]);
  if (status.trim()) {
    fail("Working tree must be clean before starting a release.");
  }
}

function assertMainBranch(): void {
  const branch = capture("git", ["branch", "--show-current"]).trim();
  if (branch !== "main") {
    fail(`Release must be started from main, current branch is ${branch || "<detached>"}.`);
  }
}

function assertMainMatchesOrigin(): void {
  const localMain = capture("git", ["rev-parse", "HEAD"]).trim();
  const originMain = capture("git", ["rev-parse", "origin/main"]).trim();

  if (localMain !== originMain) {
    fail("Local main must match origin/main before starting a release.");
  }
}

function assertTagDoesNotExist(tag: string): void {
  const localTag = spawnSync("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`], {
    cwd: resolveRepoPath(),
    stdio: "ignore"
  });
  if (localTag.status === 0) {
    fail(`Local tag ${tag} already exists.`);
  }

  const remoteTag = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], {
    cwd: resolveRepoPath(),
    stdio: "ignore"
  });
  if (remoteTag.status === 0) {
    fail(`Remote tag ${tag} already exists.`);
  }
  if (remoteTag.status !== 2) {
    fail(`Unable to check whether remote tag ${tag} exists.`);
  }
}

function hasStagedChanges(): boolean {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: resolveRepoPath(),
    stdio: "ignore"
  });

  return result.status === 1;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: resolveRepoPath(),
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: resolveRepoPath(),
    env: process.env,
    encoding: "utf8"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
