import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export const companionServerPort = 48_115;
export const companionServerOrigin = `http://127.0.0.1:${companionServerPort}`;
export const defaultOutputDirName = "jittle-lamp-sessions";

const configDirPath = join(homedir(), ".jittle-lamp");
const configFilePath = join(configDirPath, "companion.json");

export type CompanionConfig = {
  outputDir: string;
};

export type CompanionConfigSource = "env" | "file" | "default";

export type ResolvedCompanionConfig = CompanionConfig & {
  configFilePath: string;
  defaultOutputDir: string;
  envOverrideActive: boolean;
  savedOutputDir: string | null;
  source: CompanionConfigSource;
};

export function isTrustedCompanionOrigin(origin: string | null): boolean {
  return typeof origin === "string" && origin.startsWith("chrome-extension://");
}

export function defaultOutputDir(): string {
  return resolve(homedir(), defaultOutputDirName);
}

export function normalizeOutputDir(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("The output directory cannot be empty.");
  }

  return resolve(trimmed);
}

export async function loadCompanionConfig(): Promise<CompanionConfig> {
  const resolved = await loadResolvedCompanionConfig();

  return {
    outputDir: resolved.outputDir
  };
}

export async function loadResolvedCompanionConfig(): Promise<ResolvedCompanionConfig> {
  const envOutputDir = process.env.JITTLE_LAMP_OUTPUT_DIR?.trim();
  const savedConfig = await readSavedCompanionConfig();
  const fallbackOutputDir = defaultOutputDir();

  if (envOutputDir) {
    return {
      configFilePath,
      defaultOutputDir: fallbackOutputDir,
      envOverrideActive: true,
      outputDir: normalizeOutputDir(envOutputDir),
      savedOutputDir: savedConfig?.outputDir ?? null,
      source: "env"
    };
  }

  if (savedConfig) {
    return {
      ...savedConfig,
      configFilePath,
      defaultOutputDir: fallbackOutputDir,
      envOverrideActive: false,
      savedOutputDir: savedConfig.outputDir,
      source: "file"
    };
  }

  return {
    configFilePath,
    defaultOutputDir: fallbackOutputDir,
    envOverrideActive: false,
    outputDir: fallbackOutputDir,
    savedOutputDir: null,
    source: "default"
  };
}

export async function saveCompanionConfig(input: CompanionConfig): Promise<CompanionConfig> {
  const normalized = {
    outputDir: normalizeOutputDir(input.outputDir)
  };

  await mkdir(configDirPath, { recursive: true });
  await writeFile(`${configFilePath}`, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

async function readSavedCompanionConfig(): Promise<CompanionConfig | null> {
  try {
    const fileText = await readFile(configFilePath, "utf8");
    const parsed = JSON.parse(fileText) as Partial<CompanionConfig>;

    return {
      outputDir: normalizeOutputDir(parsed.outputDir ?? defaultOutputDir())
    };
  } catch {
    return null;
  }
}

export function resolveArtifactDestinationPath(input: {
  outputDir: string;
  sessionId: string;
  artifactName: "recording.webm" | "session.events.json";
}): string {
  if (!/^[A-Za-z0-9._-]+$/.test(input.sessionId)) {
    throw new Error(`Invalid session id: ${input.sessionId}`);
  }

  const root = normalizeOutputDir(input.outputDir);
  const candidate = resolve(root, input.sessionId, input.artifactName);

  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error("Resolved artifact path escapes the configured output directory.");
  }

  return candidate;
}
