import { bootstrap as bootstrapReact } from "./react-app";
import {
  persistWebViewerImplementation,
  readWebViewerImplementationFromEnvironment,
  reportWebViewerTelemetry,
  type ViewerImplementation
} from "./viewer-rollout";

function bootstrapLegacy(): void {
  // Legacy path currently reuses the existing viewer shell while rollout stabilizes.
  bootstrapReact();
}

function bootstrapWithRollout(): void {
  const selectedImplementation = readWebViewerImplementationFromEnvironment();
  persistWebViewerImplementation(selectedImplementation);
  reportWebViewerTelemetry({ implementation: selectedImplementation, phase: "selected" });

  const boot = (implementation: ViewerImplementation): void => {
    if (implementation === "react") {
      bootstrapReact();
    } else {
      bootstrapLegacy();
    }
  };

  try {
    boot(selectedImplementation);
    reportWebViewerTelemetry({ implementation: selectedImplementation, phase: "booted" });
  } catch (error) {
    reportWebViewerTelemetry({ implementation: selectedImplementation, phase: "boot_failed", error });
    if (selectedImplementation === "react") {
      bootstrapLegacy();
      reportWebViewerTelemetry({ implementation: "legacy", phase: "fallback", error });
    } else {
      throw error;
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapWithRollout, { once: true });
} else {
  bootstrapWithRollout();
}
