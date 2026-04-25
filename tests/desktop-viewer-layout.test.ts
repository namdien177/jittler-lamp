import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("viewer modal layout CSS", () => {
  const css = readFileSync(
    join(import.meta.dir, "..", "packages", "viewer-react", "src", "viewer-modal", "styles.ts"),
    "utf8"
  );

  test("modal occupies ~90% of the viewport on each axis", () => {
    expect(css).toMatch(/\.jl-vm-modal\s*\{[\s\S]*?width:\s*min\(90vw,[^)]+\);/);
    expect(css).toMatch(/\.jl-vm-modal\s*\{[\s\S]*?height:\s*90vh;/);
  });

  test("two-column body keeps left flexible and caps right pane at 600px", () => {
    expect(css).toMatch(/\.jl-vm-body\s*\{[\s\S]*?grid-template-columns:\s*3fr\s*minmax\(0,\s*600px\);/);
  });

  test("left/right panes can shrink without forcing layout overflow", () => {
    expect(css).toMatch(/\.jl-vm-left\s*\{[\s\S]*?min-width:\s*0;/);
    expect(css).toMatch(/\.jl-vm-right\s*\{[\s\S]*?min-width:\s*0;/);
  });

  test("video container uses 4:3 aspect ratio", () => {
    expect(css).toMatch(/\.jl-vm-video-inner\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3;/);
  });

  test("drawer can grow to at most 70% of the right pane", () => {
    expect(css).toMatch(/\.jl-vm-drawer\s*\{[\s\S]*?max-height:\s*70%;/);
  });

  test("row labels truncate instead of pushing the layout", () => {
    expect(css).toMatch(/\.jl-vm-row-label\s*\{[\s\S]*?min-width:\s*0;/);
    expect(css).toMatch(/\.jl-vm-row-label\s*\{[\s\S]*?text-overflow:\s*ellipsis;/);
  });
});
