export type ViewerImplementation = "legacy" | "react";

const QUERY_KEY = "viewer";
const STORAGE_KEY = "jl.viewer.web.implementation";

function normalizeImplementation(value: string | null | undefined): ViewerImplementation | null {
  if (!value) return null;
  if (value === "react" || value === "legacy") return value;
  return null;
}

export function resolveWebViewerImplementation(search: string, storageValue?: string | null): ViewerImplementation {
  const params = new URLSearchParams(search);
  const fromQuery = normalizeImplementation(params.get(QUERY_KEY));
  if (fromQuery) return fromQuery;

  const fromStorage = normalizeImplementation(storageValue);
  if (fromStorage) return fromStorage;

  return "legacy";
}

export function readWebViewerImplementationFromEnvironment(): ViewerImplementation {
  const storageValue = (() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  })();

  return resolveWebViewerImplementation(window.location.search, storageValue);
}

export function persistWebViewerImplementation(value: ViewerImplementation): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore storage failures in private mode / restricted envs
  }
}

export function reportWebViewerTelemetry(event: {
  implementation: ViewerImplementation;
  phase: "selected" | "booted" | "boot_failed" | "fallback";
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
