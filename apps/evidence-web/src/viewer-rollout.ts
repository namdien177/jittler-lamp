export type ViewerImplementation = "react";

export function reportWebViewerTelemetry(event: {
  implementation: ViewerImplementation;
  phase: "selected" | "booted" | "boot_failed";
  error?: unknown;
}): void {
  const payload = {
    surface: "web",
    viewerImplementation: event.implementation,
    phase: event.phase,
    timestamp: new Date().toISOString(),
    error: event.error instanceof Error ? event.error.message : event.error ? String(event.error) : undefined
  };

  console.info("[jittle-lamp][viewer-rollout]", payload);
  window.dispatchEvent(new CustomEvent("jittle-lamp:viewer-rollout", { detail: payload }));
}
