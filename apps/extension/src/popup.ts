import { popupResponseSchema, type PopupResponse, type PopupState } from "@jittle-lamp/shared";

const refreshIntervalMs = 1_500;

const statusBadge = requireElement<HTMLSpanElement>("[data-role='status-badge']");
const companionStatus = requireElement<HTMLElement>("[data-role='companion-status']");
const companionRoute = requireElement<HTMLParagraphElement>("[data-role='companion-route']");
const companionPill = requireElement<HTMLSpanElement>("[data-role='companion-pill']");
const titleValue = requireElement<HTMLSpanElement>("[data-role='title-value']");
const urlValue = requireElement<HTMLSpanElement>("[data-role='url-value']");
const sessionValue = requireElement<HTMLSpanElement>("[data-role='session-value']");
const eventsValue = requireElement<HTMLSpanElement>("[data-role='events-value']");
const artifactValue = requireElement<HTMLSpanElement>("[data-role='artifact-value']");
const messageValue = requireElement<HTMLParagraphElement>("[data-role='message-value']");
const startButton = requireElement<HTMLButtonElement>("[data-role='start-button']");
const stopButton = requireElement<HTMLButtonElement>("[data-role='stop-button']");

let requestInFlight = false;

void refreshState();
setInterval(() => {
  void refreshState();
}, refreshIntervalMs);

startButton.addEventListener("click", () => {
  void performAction("jl/popup-start-recording");
});

stopButton.addEventListener("click", () => {
  void performAction("jl/popup-stop-recording");
});

async function performAction(type: "jl/popup-start-recording" | "jl/popup-stop-recording"): Promise<void> {
  if (requestInFlight) {
    return;
  }

  requestInFlight = true;
  setButtonsDisabled(true);
  let transientError: string | undefined;

  try {
    if (type === "jl/popup-start-recording") {
      const granted = await chrome.permissions.request({
        origins: ["<all_urls>"]
      });

      if (!granted) {
        transientError = "Grant site access to keep interaction capture running across navigations.";
        return;
      }
    }

    const response = await sendPopupMessage(type);

    if (response.error) {
      transientError = response.error;
    }
  } catch (error: unknown) {
    transientError = error instanceof Error ? error.message : String(error);
  } finally {
    requestInFlight = false;
  }

  await refreshState(transientError);
}

async function refreshState(errorOverride?: string): Promise<void> {
  if (requestInFlight) {
    return;
  }

  try {
    const response = await sendPopupMessage("jl/popup-get-state");
    renderState(response.state, errorOverride ?? response.error);
  } catch (error: unknown) {
    renderState(emptyPopupState(), errorOverride ?? (error instanceof Error ? error.message : String(error)));
  }
}

async function sendPopupMessage(
  type: "jl/popup-get-state" | "jl/popup-start-recording" | "jl/popup-stop-recording"
): Promise<PopupResponse> {
  return popupResponseSchema.parse(
    await chrome.runtime.sendMessage({
      type
    })
  );
}

function renderState(state: PopupState, error?: string): void {
  const activeSession = state.activeSession;

  statusBadge.textContent = activeSession?.phase ?? "idle";
  statusBadge.dataset.phase = activeSession?.phase ?? "idle";

  companionStatus.textContent =
    state.companion.status === "online" ? "Desktop companion online" : "Desktop companion offline";
  companionRoute.textContent =
    state.companion.status === "online"
      ? state.companion.outputDir ?? state.companion.origin
      : `${state.companion.origin} unavailable`;
  companionPill.textContent = state.companion.status;
  companionPill.dataset.status = state.companion.status;

  titleValue.textContent = activeSession?.name ?? "No session yet";
  urlValue.textContent = activeSession?.page.url ?? "Open an http(s) page to start recording.";
  sessionValue.textContent = activeSession?.sessionId ?? "—";
  eventsValue.textContent = String(activeSession?.eventCount ?? 0);
  artifactValue.textContent = (activeSession?.artifacts ?? [])
    .map((artifact) => artifact.relativePath)
    .join("\n") || "—";

  if (error) {
    messageValue.textContent = error;
    messageValue.dataset.tone = "error";
  } else if (activeSession?.statusText) {
    messageValue.textContent = activeSession.statusText;
    messageValue.dataset.tone = "neutral";
  } else if (activeSession?.phase === "recording") {
    messageValue.textContent =
      state.companion.status === "online"
        ? `Recording the active tab. Stop to save directly into ${state.companion.outputDir ?? "the desktop companion folder"}.`
        : "Recording the active tab. Stop to download the session through Chromium.";
    messageValue.dataset.tone = "neutral";
  } else if (state.companion.status === "online") {
    messageValue.textContent = `Desktop companion ready. New stopped sessions will save into ${state.companion.outputDir ?? state.companion.origin}.`;
    messageValue.dataset.tone = "neutral";
  } else {
    messageValue.textContent = "Desktop companion offline. Stopped sessions will download through Chromium.";
    messageValue.dataset.tone = "neutral";
  }

  startButton.disabled = requestInFlight || !state.canStart;
  stopButton.disabled = requestInFlight || !state.canStop;
}

function setButtonsDisabled(disabled: boolean): void {
  startButton.disabled = disabled;
  stopButton.disabled = disabled;
}

function requireElement<ElementType extends Element>(selector: string): ElementType {
  const element = document.querySelector<ElementType>(selector);

  if (!element) {
    throw new Error(`Missing popup element: ${selector}`);
  }

  return element;
}

function emptyPopupState(): PopupState {
  return {
    activeSession: null,
    companion: {
      status: "offline",
      origin: "http://127.0.0.1:48115",
      checkedAt: new Date().toISOString()
    },
    canStart: true,
    canStop: false
  };
}
