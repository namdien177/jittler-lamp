import { popupResponseSchema, type PopupResponse, type PopupState } from "@jittle-lamp/shared";

const statusBadge = requireElement<HTMLSpanElement>("[data-role='status-badge']");
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
  let nextState = emptyPopupState();
  let nextError: string | undefined;

  try {
    if (type === "jl/popup-start-recording") {
      const granted = await chrome.permissions.request({
        origins: ["<all_urls>"]
      });

      if (!granted) {
        nextError = "Grant site access to keep interaction capture running across navigations.";
        return;
      }
    }

    const response = await sendPopupMessage(type);
    nextState = response.state;
    nextError = response.error;
  } catch (error: unknown) {
    nextError = error instanceof Error ? error.message : String(error);
  } finally {
    requestInFlight = false;
    renderState(nextState, nextError);
  }
}

async function refreshState(): Promise<void> {
  try {
    const response = await sendPopupMessage("jl/popup-get-state");
    renderState(response.state, response.error);
  } catch (error: unknown) {
    renderState(emptyPopupState(), error instanceof Error ? error.message : String(error));
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

  titleValue.textContent = activeSession?.name ?? "No active session";
  urlValue.textContent = activeSession?.page.url ?? "Open an http(s) page to start recording.";
  sessionValue.textContent = activeSession?.sessionId ?? "—";
  eventsValue.textContent = String(activeSession?.eventCount ?? 0);
  artifactValue.textContent = (activeSession?.artifacts ?? [])
    .map((artifact) => artifact.relativePath)
    .join("\n") || "—";

  if (error) {
    messageValue.textContent = error;
    messageValue.dataset.tone = "error";
  } else if (activeSession) {
    messageValue.textContent = `Tracking tab ${activeSession.page.tabId ?? "?"} locally.`;
    messageValue.dataset.tone = "neutral";
  } else {
    messageValue.textContent = "Starts a local-only active-tab session and exports WebM + JSON with browser downloads.";
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
    canStart: true,
    canStop: false
  };
}
