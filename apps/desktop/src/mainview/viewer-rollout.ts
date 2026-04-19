export type ViewerImplementation = "react";

export function reportDesktopViewerTelemetry(event: {
  implementation: ViewerImplementation;
  phase: "selected" | "booted" | "boot_failed";
  error?: unknown;
}): void {
  const payload = {
    surface: "desktop",
    viewerImplementation: event.implementation,
    phase: event.phase,
    timestamp: new Date().toISOString(),
    error: event.error instanceof Error ? event.error.message : event.error ? String(event.error) : undefined
  };

  console.info("[jittle-lamp][viewer-rollout]", payload);
}
