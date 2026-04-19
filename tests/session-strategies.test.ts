import { afterEach, describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { createSessionArchive, createSessionDraft } from "@jittle-lamp/shared";

import { createWebSessionStrategies } from "../apps/evidence-web/src/session-strategy";
import { createDesktopSessionStrategies } from "../apps/desktop/src/bun/session-strategy";

const VALID_BUNDLE = createSessionArchive(
  createSessionDraft({
    page: {
      title: "Strategy Test",
      url: "https://example.com"
    },
    now: new Date("2026-01-01T00:00:00.000Z")
  })
);

const SESSION_ID = VALID_BUNDLE.sessionId;
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function makeZipBytes(): Uint8Array {
  return zipSync({
    "session.archive.json": strToU8(JSON.stringify(VALID_BUNDLE)),
    "recording.webm": new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
  });
}

describe("web session strategies", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("local ZIP strategy works offline with fetch disabled", async () => {
    globalThis.fetch = ((() => {
      throw new Error("network disabled");
    }) as unknown) as typeof fetch;

    const zipFile = new File([toArrayBuffer(makeZipBytes())], "session.zip", { type: "application/zip" });
    const payload = await createWebSessionStrategies().local.load(zipFile);

    expect(payload.archive.sessionId).toBe(SESSION_ID);
    expect(payload.videoUrl.startsWith("blob:")).toBe(true);
  });

  test("remote ZIP strategy is additive and can load without auth", async () => {
    globalThis.fetch = (async (_url: string | URL | Request) => {
      return new Response(toArrayBuffer(makeZipBytes()), {
        status: 200,
        headers: { "content-type": "application/zip" }
      });
    }) as typeof fetch;

    const payload = await createWebSessionStrategies().remote.load({ zipUrl: "https://example.test/session.zip" });
    expect(payload.archive.sessionId).toBe(SESSION_ID);
  });

  test("remote ZIP strategy forwards bearer auth when provided", async () => {
    let authHeader = "";
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      authHeader = headers.get("authorization") ?? "";
      return new Response(toArrayBuffer(makeZipBytes()), { status: 200 });
    }) as typeof fetch;

    await createWebSessionStrategies().remote.load({
      zipUrl: "https://example.test/secure.zip",
      authToken: "token-123"
    });

    expect(authHeader).toBe("Bearer token-123");
  });
});

describe("desktop session strategies", () => {
  test("local strategy metadata does not require auth configuration", async () => {
    const strategies = createDesktopSessionStrategies(new Map());
    expect(strategies.local.mode).toBe("local");
    expect(strategies.remote.mode).toBe("remote");
    expect(strategies.zip.mode).toBe("zip");
  });

  test("remote desktop strategy supports optional auth while preserving shared ZIP handling", async () => {
    const originalFetch = globalThis.fetch;
    let authHeader = "";

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(toArrayBuffer(makeZipBytes()), { status: 200 });
    }) as typeof fetch;

    try {
      const strategies = createDesktopSessionStrategies(new Map());
      const payload = await strategies.remote.load({ zipUrl: "https://example.test/s.zip", authToken: "abc" });
      expect(payload.source).toBe("zip");
      expect(payload.archive.sessionId).toBe(SESSION_ID);
      expect(authHeader).toBe("Bearer abc");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
