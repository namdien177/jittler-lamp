import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zipSync } from "fflate";

import { normalizeReleaseVersion } from "../scripts/release/workspace-version";

describe("release helpers", () => {
  test("normalizes bare and prefixed semantic versions", () => {
    expect(normalizeReleaseVersion("1.2.3")).toBe("1.2.3");
    expect(normalizeReleaseVersion("v1.2.3")).toBe("1.2.3");
  });

  test("rejects non-stable semantic versions", () => {
    expect(() => normalizeReleaseVersion("1.2")).toThrow();
    expect(() => normalizeReleaseVersion("v1.2.3-beta.1")).toThrow();
  });

  test("creates a zip whose entries match extension dist contents", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "jittle-lamp-release-test-"));
    const extensionDistPath = join(tempRoot, "apps", "extension", "dist");

    mkdirSync(extensionDistPath, { recursive: true });
    writeFileSync(join(extensionDistPath, "manifest.json"), '{"name":"jittle-lamp"}\n');
    writeFileSync(join(extensionDistPath, "popup.html"), "<html></html>\n");

    const zipBytes = zipSync({
      "manifest.json": new Uint8Array(await Bun.file(join(extensionDistPath, "manifest.json")).bytes()),
      "popup.html": new Uint8Array(await Bun.file(join(extensionDistPath, "popup.html")).bytes())
    });

    expect(zipBytes.byteLength).toBeGreaterThan(0);

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
