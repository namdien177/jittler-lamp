import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _testResetCompanionMediaRegistry,
  handleCompanionRequest,
  registerMediaPlayback
} from "../apps/desktop/src/companion/server";

describe("companion media playback endpoint", () => {
  let tempDir: string;
  let videoPath: string;
  let originalBytes: Uint8Array;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `jl-test-media-${Date.now()}`);
    videoPath = join(tempDir, "recording.webm");
    originalBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x10, 0x20]);

    _testResetCompanionMediaRegistry();
    await mkdir(tempDir, { recursive: true });
    await writeFile(videoPath, originalBytes);
  });

  afterEach(async () => {
    _testResetCompanionMediaRegistry();
    await rm(tempDir, { recursive: true, force: true });
  });

  test("serves a registered media file with content type and byte range support", async () => {
    const url = registerMediaPlayback({ filePath: videoPath, mimeType: "video/webm;codecs=vp8" });

    const response = await handleCompanionRequest(new Request(url));
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/webm;codecs=vp8");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(String(originalBytes.byteLength));
    expect(Array.from(bytes)).toEqual(Array.from(originalBytes));
  });

  test("supports explicit byte ranges with 206 partial content", async () => {
    const url = registerMediaPlayback({ filePath: videoPath, mimeType: "video/webm" });

    const response = await handleCompanionRequest(
      new Request(url, {
        headers: {
          range: "bytes=0-1"
        }
      })
    );

    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 0-1/${originalBytes.byteLength}`);
    expect(response.headers.get("content-length")).toBe("2");
    expect(Array.from(bytes)).toEqual(Array.from(originalBytes.slice(0, 2)));
  });

  test("returns 404 for unknown media ids", async () => {
    const response = await handleCompanionRequest(new Request("http://127.0.0.1:48115/api/media/does-not-exist"));

    expect(response.status).toBe(404);
  });

  test("returns 404 when the registered file is later missing", async () => {
    const url = registerMediaPlayback({ filePath: videoPath, mimeType: "video/webm" });
    await rm(videoPath, { force: true });

    const response = await handleCompanionRequest(new Request(url));

    expect(response.status).toBe(404);
  });

  test("returns 416 for invalid byte ranges", async () => {
    const url = registerMediaPlayback({ filePath: videoPath, mimeType: "video/webm" });

    const response = await handleCompanionRequest(
      new Request(url, {
        headers: {
          range: `bytes=${originalBytes.byteLength}-`
        }
      })
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${originalBytes.byteLength}`);
  });
});
