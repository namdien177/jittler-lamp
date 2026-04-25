import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = new URL("../../../", import.meta.url);
const artifactsRoot = new URL("../artifacts/", import.meta.url);

const requestedMode = readOption("mode") ?? "local";
const requestedBuildEnv = readOption("env") ?? "stable";
const mode = requestedMode === "ci" ? "ci" : "local";
const buildEnv = ["dev", "canary", "stable"].includes(requestedBuildEnv) ? requestedBuildEnv : "stable";

if (mode === "local") {
  loadWorkspaceEnv();
} else if (!process.env.CSC_LINK) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY ??= "false";
}

process.env.JITTLE_LAMP_DESKTOP_BUILD_ENV = buildEnv;

rmSync(artifactsRoot, { recursive: true, force: true });
run("bun", ["run", "./scripts/build.ts", `--env=${buildEnv}`]);
run("bun", ["x", "electron-builder"]);

function readOption(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function loadWorkspaceEnv(): void {
  const envFile = new URL(".env", workspaceRoot);

  if (!existsSync(envFile)) {
    console.info("No workspace .env found; packaging will use the current shell environment.");
    return;
  }

  const values = parseEnv(readFileSync(envFile, "utf8"));

  for (const [name, value] of Object.entries(values)) {
    process.env[name] ??= value;
  }

  console.info(`Loaded desktop packaging environment from ${fileURLToPath(envFile)}.`);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
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
