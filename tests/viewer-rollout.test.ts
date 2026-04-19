import { describe, expect, test } from "bun:test";
import { resolveWebViewerImplementation } from "../apps/evidence-web/src/viewer-rollout";
import { resolveDesktopViewerImplementation } from "../apps/desktop/src/mainview/viewer-rollout";

describe("viewer rollout feature flags", () => {
  test("query param overrides storage on web", () => {
    expect(resolveWebViewerImplementation("?viewer=react", "legacy")).toBe("react");
    expect(resolveWebViewerImplementation("?viewer=legacy", "react")).toBe("legacy");
  });

  test("storage controls implementation when query is absent", () => {
    expect(resolveWebViewerImplementation("", "react")).toBe("react");
    expect(resolveDesktopViewerImplementation("", "legacy")).toBe("legacy");
  });

  test("defaults to legacy for safe rollback", () => {
    expect(resolveWebViewerImplementation("", null)).toBe("legacy");
    expect(resolveDesktopViewerImplementation("?viewer=unknown", "invalid")).toBe("legacy");
  });
});
