import { bootstrap as bootstrapReact } from "./react-app";
import {
  persistWebViewerImplementation,
  readWebViewerImplementationFromEnvironment,
  reportWebViewerTelemetry,
  type ViewerImplementation
} from "./viewer-rollout";

function bootstrapLegacy(): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("Evidence web root element was not found.");
  root.innerHTML = "";

  const container = document.createElement("main");
  container.className = "viewer-empty";

  const title = document.createElement("h2");
  title.textContent = "Legacy viewer";

  const message = document.createElement("p");
  message.textContent = "React viewer could not be loaded in this session. Legacy mode is active for stability.";

  container.append(title, message);
  root.append(container);
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
