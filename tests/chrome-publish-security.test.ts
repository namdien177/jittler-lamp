import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchChromeExtensionStatus,
  publishChromeExtension,
  uploadChromeExtension,
  waitForChromeUpload
} from "../scripts/release/publish-chrome-extension";

describe("Chrome publishing credential boundary", () => {
  const token = "test-token-must-never-appear-in-errors";
  const input = { accessToken: token, publisherId: "publisher", extensionId: "extension" };
  const fetchTarget: { fetch: (url: RequestInfo | URL, options?: RequestInit) => Promise<Response> } = globalThis;
  const fetchSpy = spyOn(fetchTarget, "fetch");
  afterEach(() => fetchSpy.mockReset());
  afterAll(() => fetchSpy.mockRestore());

  test("sends the token only in the authorization header and refuses redirects", async () => {
    const root = mkdtempSync(join(tmpdir(), "chrome-upload-"));
    const zipPath = join(root, "extension.zip");
    writeFileSync(zipPath, "test archive bytes");
    fetchSpy.mockImplementation(async (url, options) => {
      expect(new URL(String(url)).origin).toBe("https://chromewebstore.googleapis.com");
      expect(String(url)).not.toContain(token);
      expect(new Headers(options?.headers).get("authorization")).toBe(`Bearer ${token}`);
      expect(options?.redirect).toBe("error");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      if (typeof options?.body === "string") expect(options.body).not.toContain(token);
      return Response.json({ uploadState: "SUCCEEDED" });
    });
    try {
      await uploadChromeExtension({ ...input, zipPath });
      await fetchChromeExtensionStatus(input);
      await publishChromeExtension({ ...input, publishType: "DEFAULT_PUBLISH" });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not expose reflected response data or transport errors", async () => {
    fetchSpy.mockResolvedValue(Response.json({ error: token }, { status: 403 }));
    await expect(fetchChromeExtensionStatus(input)).rejects.toMatchObject({ message: "Chrome Web Store status fetch failed (HTTP 403)." });
    fetchSpy.mockRejectedValue(new Error(`request included Bearer ${token}`));
    await expect(publishChromeExtension({ ...input, publishType: "DEFAULT_PUBLISH" }))
      .rejects.toMatchObject({ message: "Chrome Web Store request failed or timed out." });
  });

  test("never logs arbitrary upload states returned by the API", async () => {
    const log = spyOn(console, "info").mockImplementation(() => {});
    fetchSpy.mockResolvedValue(Response.json({ lastAsyncUploadState: token, error: token }));
    try {
      await expect(waitForChromeUpload({ ...input, initialUpload: { uploadState: "IN_PROGRESS" }, intervalMs: 0 }))
        .rejects.toMatchObject({ message: "Chrome Web Store upload failed or did not finish successfully." });
      expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    } finally {
      log.mockRestore();
    }
  });
});

describe("release source checks before code execution", () => {
  for (const workflow of ["release.yml", "publish-chrome.yml"]) {
    test(`${workflow} accepts only stable tag pushes at main HEAD`, () => {
      const text = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8");
      const guard = text.split("      - name: Verify release source\n")[1]?.split("      - name:")[0];
      const script = guard?.split("        run: |\n")[1]?.replace(/^          /gm, "");
      expect(script).toBeDefined();
      expect(text.indexOf("Verify release source")).toBeLessThan(text.indexOf("uses:"));
      const root = mkdtempSync(join(tmpdir(), "release-guard-"));
      writeFileSync(join(root, "gh"), '#!/bin/sh\nprintf "%s\\n" "$TEST_MAIN_SHA"\n', { mode: 0o700 });
      const env = {
        ...process.env, PATH: `${root}:${process.env.PATH}`, TEST_MAIN_SHA: "abc123",
        GITHUB_REPOSITORY: "namdien177/jittle-lamp", GITHUB_EVENT_NAME: "push",
        GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v1.2.3", GITHUB_SHA: "abc123",
        GITHUB_OUTPUT: join(root, "output")
      };
      try {
        const run = (overrides = {}) => Bun.spawnSync(["bash", "-c", script!], { env: { ...env, ...overrides } });
        expect(run().exitCode).toBe(0);
        expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("version=1.2.3\n");
        for (const overrides of [
          { GITHUB_REPOSITORY: "attacker/jittle-lamp" }, { GITHUB_EVENT_NAME: "pull_request" },
          { GITHUB_REF_TYPE: "branch" }, { GITHUB_SHA: "other-commit" },
          { GITHUB_REF_NAME: "v1.2.3-beta.1" }, { GITHUB_REF_NAME: 'v1.2.3$(exit 0)' },
          { TEST_MAIN_SHA: "" }
        ]) expect(run(overrides).exitCode).not.toBe(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
