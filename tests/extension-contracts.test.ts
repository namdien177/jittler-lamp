import { describe, expect, test } from "bun:test";
import {
  defaultOutputDir,
  isTrustedCompanionOrigin,
  normalizeOutputDir,
  resolveArtifactDestinationPath
} from "../apps/desktop/src/companion/config";

import {
  contentRuntimeMessageSchema,
  createSessionBundle,
  createSessionDraft,
  offscreenRequestSchema,
  popupResponseSchema,
  transitionDraftPhase
} from "@jittle-lamp/shared";

describe("extension contracts", () => {
  test("parses popup state responses with no active session", () => {
    const response = popupResponseSchema.parse({
      ok: true,
      state: {
        activeSession: null,
        canStart: true,
        canStop: false
      }
    });

    expect(response.state.activeSession).toBeNull();
    expect(response.state.canStart).toBeTrue();
  });

  test("parses popup state responses with typed active-session summaries", () => {
    const response = popupResponseSchema.parse({
      ok: true,
      state: {
        activeSession: {
          sessionId: "jl_test1234",
          name: "Example",
          phase: "recording",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:05.000Z",
          page: {
            tabId: 7,
            title: "Example",
            url: "https://example.com"
          },
          artifacts: [
            {
              kind: "recording.webm",
              relativePath: "jl_test1234/recording.webm",
              mimeType: "video/webm"
            },
            {
              kind: "session.events.json",
              relativePath: "jl_test1234/session.events.json",
              mimeType: "application/json"
            }
          ],
          eventCount: 42
        },
        canStart: false,
        canStop: true
      }
    });

    expect(response.state.activeSession?.eventCount).toBe(42);
    expect(response.state.activeSession?.page.tabId).toBe(7);
  });

  test("parses session-scoped content runtime messages", () => {
    const message = contentRuntimeMessageSchema.parse({
      type: "jl/interaction",
      sessionId: "jl_test1234",
      payload: {
        kind: "interaction",
        type: "click",
        selector: "button.primary",
        x: 12,
        y: 24
      }
    });

    expect(message.sessionId).toBe("jl_test1234");
    if (!("payload" in message)) {
      throw new Error("Expected an interaction message.");
    }

    expect(message.payload.type).toBe("click");
  });

  test("parses offscreen export requests with full session bundles", () => {
    const draft = transitionDraftPhase(
      createSessionDraft({
        page: {
          title: "Example",
          url: "https://example.com"
        },
        now: new Date("2026-01-01T00:00:00.000Z")
      }),
      "ready",
      "Queued local export.",
      new Date("2026-01-01T00:00:02.000Z")
    );

    const request = offscreenRequestSchema.parse({
      type: "jl/offscreen-stop-and-export",
      sessionId: draft.sessionId,
      bundle: createSessionBundle(draft)
    });

    if (!("bundle" in request)) {
      throw new Error("Expected an export request.");
    }

    expect(request.bundle.phase).toBe("ready");
    expect(request.bundle.artifacts).toHaveLength(2);
  });

  test("resolves companion artifact destinations inside the configured output directory", () => {
    const outputDir = normalizeOutputDir(defaultOutputDir());
    const artifactPath = resolveArtifactDestinationPath({
      outputDir,
      sessionId: "jl_test1234",
      artifactName: "recording.webm"
    });

    expect(artifactPath.startsWith(outputDir)).toBeTrue();
    expect(artifactPath.endsWith("jl_test1234/recording.webm")).toBeTrue();
  });

  test("accepts only extension origins for companion writes", () => {
    expect(isTrustedCompanionOrigin("chrome-extension://abcdefghijklmnop")).toBeTrue();
    expect(isTrustedCompanionOrigin("https://example.com")).toBeFalse();
    expect(isTrustedCompanionOrigin(null)).toBeFalse();
  });
});
