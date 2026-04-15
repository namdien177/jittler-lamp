import { describe, expect, test } from "bun:test";

import {
  appendDraftEvent,
  createSessionBundle,
  createSessionDraft,
  sanitizeCapturedUrl,
  sessionBundleSchema,
  sessionSchemaVersion,
  transitionDraftPhase
} from "@jittle-lamp/shared";

describe("session contracts", () => {
  test("creates a draft with local artifact paths", () => {
    const draft = createSessionDraft({
      page: {
        tabId: 7,
        title: "Example",
        url: "https://example.com"
      },
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(draft.artifacts.map((artifact) => artifact.kind)).toEqual([
      "recording.webm",
      "session.events.json"
    ]);
    expect(draft.name).toBe("Example");
    expect(draft.page.tabId).toBe(7);
  });

  test("parses a bundle built from draft events", () => {
    const draft = transitionDraftPhase(
      appendDraftEvent(
        createSessionDraft({
          page: {
            title: "Example",
            url: "https://example.com"
          },
          now: new Date("2026-01-01T00:00:00.000Z")
        }),
        {
          kind: "interaction",
          type: "click",
          selector: "button.primary",
          x: 40,
          y: 24
        },
        new Date("2026-01-01T00:00:01.000Z")
      ),
      "ready",
      "Exported locally.",
      new Date("2026-01-01T00:00:02.000Z")
    );

    const bundle = sessionBundleSchema.parse(createSessionBundle(draft));

    expect(bundle.schemaVersion).toBe(sessionSchemaVersion);
    expect(bundle.phase).toBe("ready");
    expect(bundle.events).toHaveLength(3);
    expect(bundle.artifacts[0]?.relativePath.endsWith("recording.webm")).toBeTrue();
  });

  test("preserves richer network payloads in exported bundles", () => {
    const draft = appendDraftEvent(
      createSessionDraft({
        page: {
          title: "Example",
          url: "https://example.com"
        },
        now: new Date("2026-01-01T00:00:00.000Z")
      }),
      {
        kind: "network",
        method: "POST",
        url: "https://example.com/api/login",
        status: 200,
        statusText: "OK",
        durationMs: 240,
        requestId: "123.45",
        request: {
          headers: [
            { name: "authorization", value: "Basic dXNlcjpzZWNyZXQ=" },
            { name: "cookie", value: "session=abc123; theme=dark" },
            { name: "content-type", value: "application/json" }
          ],
          cookies: [
            {
              cookie: {
                name: "session",
                value: "abc123",
                domain: "example.com",
                path: "/",
                httpOnly: true,
                secure: true
              },
              blockedReasons: []
            }
          ],
          body: {
            disposition: "captured",
            encoding: "utf8",
            mimeType: "application/json",
            value: '{"username":"user","password":"secret"}',
            byteLength: 39
          }
        },
        response: {
          headers: [
            { name: "content-type", value: "application/json" },
            { name: "set-cookie", value: "session=abc123; Path=/; HttpOnly; Secure" }
          ],
          setCookieHeaders: ["session=abc123; Path=/; HttpOnly; Secure"],
          setCookies: [
            {
              raw: "session=abc123; Path=/; HttpOnly; Secure",
              name: "session",
              value: "abc123",
              path: "/",
              httpOnly: true,
              secure: true,
              session: true
            }
          ],
          body: {
            disposition: "truncated",
            encoding: "base64",
            mimeType: "application/octet-stream",
            value: "YWJjZA==",
            byteLength: 2048,
            omittedByteLength: 2040,
            reason: "Body exceeded 65536 bytes and was truncated locally."
          }
        }
      },
      new Date("2026-01-01T00:00:01.000Z")
    );

    const bundle = sessionBundleSchema.parse(createSessionBundle(draft));
    const networkEvent = bundle.events[1]?.payload;

    if (!networkEvent || networkEvent.kind !== "network") {
      throw new Error("Expected a network event in the exported bundle.");
    }

    expect(networkEvent.request.headers[0]?.value).toBe("Basic dXNlcjpzZWNyZXQ=");
    expect(networkEvent.request.cookies[0]?.cookie.value).toBe("abc123");
    expect(networkEvent.request.body?.value).toContain("secret");
    expect(networkEvent.response?.setCookieHeaders[0]).toContain("session=abc123");
    expect(networkEvent.response?.body?.encoding).toBe("base64");
    expect(networkEvent.response?.body?.disposition).toBe("truncated");
  });

  test("sanitizes captured urls before storing them", () => {
    expect(sanitizeCapturedUrl("https://example.com/path?q=secret#frag")).toBe("https://example.com/path");

    const draft = createSessionDraft({
      page: {
        title: "Example",
        url: "https://example.com/path?q=secret#frag"
      },
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(draft.page.url).toBe("https://example.com/path");
  });
});
