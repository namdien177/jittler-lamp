import { existsSync, readFileSync, statSync } from "node:fs";

export type ChromePublishConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  publisherId: string;
  extensionId: string;
  publishType: "DEFAULT_PUBLISH" | "STAGED_PUBLISH";
  deployPercentage?: number;
};

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type UploadResponse = {
  uploadState?: string;
  lastAsyncUploadState?: string;
  [key: string]: unknown;
};

type PublishResponse = {
  state?: string;
  [key: string]: unknown;
};

export function readChromePublishConfig(env: NodeJS.ProcessEnv = process.env): ChromePublishConfig {
  const publishType = env.CHROME_PUBLISH_TYPE?.trim() || "DEFAULT_PUBLISH";
  if (publishType !== "DEFAULT_PUBLISH" && publishType !== "STAGED_PUBLISH") {
    throw new Error("CHROME_PUBLISH_TYPE must be either 'DEFAULT_PUBLISH' or 'STAGED_PUBLISH'.");
  }

  const deployPercentage = env.CHROME_DEPLOY_PERCENTAGE?.trim()
    ? Number.parseInt(env.CHROME_DEPLOY_PERCENTAGE, 10)
    : undefined;
  if (deployPercentage !== undefined && (!Number.isInteger(deployPercentage) || deployPercentage < 0 || deployPercentage > 100)) {
    throw new Error("CHROME_DEPLOY_PERCENTAGE must be an integer between 0 and 100.");
  }

  return {
    clientId: readRequiredEnv(env, "CHROME_CLIENT_ID"),
    clientSecret: readRequiredEnv(env, "CHROME_CLIENT_SECRET"),
    refreshToken: readRequiredEnv(env, "CHROME_REFRESH_TOKEN"),
    publisherId: readRequiredEnv(env, "CHROME_PUBLISHER_ID"),
    extensionId: readRequiredEnv(env, "CHROME_EXTENSION_ID"),
    publishType,
    ...(deployPercentage !== undefined ? { deployPercentage } : {})
  };
}

export async function requestChromeAccessToken(config: ChromePublishConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = (await response.json().catch(() => null)) as TokenResponse | null;

  if (!response.ok || !payload?.access_token) {
    throw new Error(
      `Chrome Web Store token request failed (${response.status}): ${
        payload?.error_description ?? payload?.error ?? "missing access_token"
      }`
    );
  }

  return payload.access_token;
}

export async function uploadChromeExtension(input: {
  accessToken: string;
  publisherId: string;
  extensionId: string;
  zipPath: string;
}): Promise<UploadResponse> {
  const zipBytes = readZipBytes(input.zipPath);
  const response = await fetch(
    `https://chromewebstore.googleapis.com/upload/v2/${chromeItemName(input.publisherId, input.extensionId)}:upload`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/zip"
      },
      body: new Blob([zipBytes.slice().buffer as ArrayBuffer], { type: "application/zip" })
    }
  );
  const payload = (await response.json().catch(() => null)) as UploadResponse | null;

  if (!response.ok || payload?.uploadState === "FAILED") {
    throw new Error(`Chrome Web Store upload failed (${response.status}): ${formatJson(payload)}`);
  }

  if (payload?.uploadState && payload.uploadState !== "SUCCEEDED" && payload.uploadState !== "IN_PROGRESS") {
    throw new Error(`Chrome Web Store upload did not complete successfully: ${formatJson(payload)}`);
  }

  return payload ?? {};
}

export async function waitForChromeUpload(input: {
  accessToken: string;
  publisherId: string;
  extensionId: string;
  initialUpload: UploadResponse;
  maxAttempts?: number;
  intervalMs?: number;
}): Promise<UploadResponse> {
  let current = input.initialUpload;
  const maxAttempts = input.maxAttempts ?? 30;
  const intervalMs = input.intervalMs ?? 10_000;

  for (let attempt = 1; getUploadState(current) === "IN_PROGRESS"; attempt += 1) {
    if (attempt > maxAttempts) {
      throw new Error(`Chrome Web Store upload is still in progress after ${maxAttempts} status checks.`);
    }

    await sleep(intervalMs);
    current = await fetchChromeExtensionStatus(input);
    console.info(`Chrome Web Store upload status check ${attempt}/${maxAttempts}: ${getUploadState(current)}`);
  }

  if (getUploadState(current) !== "SUCCEEDED") {
    throw new Error(`Chrome Web Store upload failed or did not finish successfully: ${formatJson(current)}`);
  }

  return current;
}

export async function fetchChromeExtensionStatus(input: {
  accessToken: string;
  publisherId: string;
  extensionId: string;
}): Promise<UploadResponse> {
  const response = await fetch(
    `https://chromewebstore.googleapis.com/v2/${chromeItemName(input.publisherId, input.extensionId)}:fetchStatus`,
    {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.accessToken}`
      }
    }
  );
  const payload = (await response.json().catch(() => null)) as UploadResponse | null;

  if (!response.ok) {
    throw new Error(`Chrome Web Store status fetch failed (${response.status}): ${formatJson(payload)}`);
  }

  return payload ?? {};
}

export async function publishChromeExtension(input: {
  accessToken: string;
  publisherId: string;
  extensionId: string;
  publishType: ChromePublishConfig["publishType"];
  deployPercentage?: number;
}): Promise<PublishResponse> {
  const deployInfos = input.deployPercentage !== undefined ? [{ deployPercentage: input.deployPercentage }] : undefined;

  const response = await fetch(`https://chromewebstore.googleapis.com/v2/${chromeItemName(input.publisherId, input.extensionId)}:publish`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      publishType: input.publishType,
      ...(deployInfos ? { deployInfos } : {})
    })
  });
  const payload = (await response.json().catch(() => null)) as PublishResponse | null;

  if (!response.ok) {
    throw new Error(`Chrome Web Store publish failed (${response.status}): ${formatJson(payload)}`);
  }

  return payload ?? {};
}

function readZipBytes(zipPath: string): Uint8Array {
  if (!existsSync(zipPath)) {
    throw new Error(`Chrome extension ZIP does not exist: ${zipPath}`);
  }

  const stats = statSync(zipPath);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error(`Chrome extension ZIP is not a non-empty file: ${zipPath}`);
  }

  return new Uint8Array(readFileSync(zipPath));
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to publish the Chrome Web Store extension.`);
  }
  return value;
}

function chromeItemName(publisherId: string, extensionId: string): string {
  return `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`;
}

function getUploadState(payload: UploadResponse): string | undefined {
  return payload.uploadState ?? payload.lastAsyncUploadState;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

if (import.meta.main) {
  const zipPath = process.argv[2];
  if (!zipPath) {
    throw new Error("Usage: bun run release:publish-chrome <path-to-extension-zip>");
  }

  const config = readChromePublishConfig();
  console.info(`Publishing Chrome Web Store extension ${config.extensionId} from ${zipPath}`);
  const accessToken = await requestChromeAccessToken(config);
  const upload = await uploadChromeExtension({
    accessToken,
    publisherId: config.publisherId,
    extensionId: config.extensionId,
    zipPath
  });
  console.info(`Chrome Web Store upload response: ${formatJson(upload)}`);
  const uploadResult = await waitForChromeUpload({
    accessToken,
    publisherId: config.publisherId,
    extensionId: config.extensionId,
    initialUpload: upload
  });
  console.info(`Chrome Web Store upload completed: ${formatJson(uploadResult)}`);
  const publish = await publishChromeExtension({
    accessToken,
    publisherId: config.publisherId,
    extensionId: config.extensionId,
    publishType: config.publishType,
    ...(config.deployPercentage !== undefined ? { deployPercentage: config.deployPercentage } : {})
  });
  console.info(`Chrome Web Store publish response: ${formatJson(publish)}`);
}
