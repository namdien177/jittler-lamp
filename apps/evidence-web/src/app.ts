import { bootstrap as bootstrapReact } from "./react-app";
import { reportWebViewerTelemetry } from "./viewer-rollout";

function bootstrapViewer(): void {
  reportWebViewerTelemetry({ implementation: "react", phase: "selected" });

  try {
    bootstrapReact();
    reportWebViewerTelemetry({ implementation: "react", phase: "booted" });
  } catch (error) {
    reportWebViewerTelemetry({ implementation: "react", phase: "boot_failed", error });
    throw error;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapViewer, { once: true });
} else {
  bootstrapViewer();
}
