export type ViewerImplementation = "legacy" | "react";

const QUERY_KEY = "viewer";
const STORAGE_KEY = "jl.viewer.desktop.implementation";

function normalizeImplementation(value: string | null | undefined): ViewerImplementation | null {
  if (!value) return null;
  if (value === "react" || value === "legacy") return value;
  return null;
}

export function resolveDesktopViewerImplementation(search: string, storageValue?: string | null): ViewerImplementation {
  const params = new URLSearchParams(search);
  const fromQuery = normalizeImplementation(params.get(QUERY_KEY));
  if (fromQuery) return fromQuery;

  const fromStorage = normalizeImplementation(storageValue);
  if (fromStorage) return fromStorage;

  return "legacy";
}

export function readDesktopViewerImplementationFromEnvironment(): ViewerImplementation {
  const storageValue = (() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();

  return resolveDesktopViewerImplementation(window.location.search, storageValue);
}

export function reportDesktopViewerTelemetry(event: {
  implementation: ViewerImplementation;
  phase: "selected" | "booted" | "boot_failed" | "fallback";
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
