import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("desktop viewer layout CSS", () => {
  const css = readFileSync(join(import.meta.dir, "..", "apps", "desktop", "src", "mainview", "index.css"), "utf8");

  test("keeps the left video pane stable when right-side content grows", () => {
    expect(css).toContain(".viewer-left {");
    expect(css).toMatch(/\.viewer-left\s*\{[\s\S]*?flex:\s*0\s+0\s+55%;/);
    expect(css).toMatch(/\.viewer-left\s*\{[\s\S]*?min-width:\s*0;/);
    expect(css).toMatch(/\.viewer-right\s*\{[\s\S]*?min-width:\s*0;/);
  });

  test("prevents long timeline labels from forcing pane expansion", () => {
    expect(css).toMatch(/\.timeline-label\s*\{[\s\S]*?min-width:\s*0;/);
    expect(css).toMatch(/\.timeline-label\s*\{[\s\S]*?text-overflow:\s*ellipsis;/);
  });
});
