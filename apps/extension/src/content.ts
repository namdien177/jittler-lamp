import { backgroundToContentMessageSchema, sanitizeCapturedUrl } from "@jittle-lamp/shared";

let activeSessionId: string | null = null;

function bootContentBridge(): void {
  if (window.__jittleLampBootstrapped__) {
    return;
  }

  window.__jittleLampBootstrapped__ = true;

  chrome.runtime.onMessage.addListener((rawMessage) => {
    const parsed = backgroundToContentMessageSchema.safeParse(rawMessage);

    if (!parsed.success) {
      return;
    }

    switch (parsed.data.type) {
      case "jl/content-begin-capture":
        activeSessionId = parsed.data.sessionId;
        void announceContentReady(parsed.data.sessionId);
        return;

      case "jl/content-end-capture":
        if (activeSessionId === parsed.data.sessionId) {
          activeSessionId = null;
        }
        return;
    }
  });

  window.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const selector = describeElement(target);

      void sendInteraction({
        kind: "interaction",
        type: "click",
        ...(selector ? { selector } : {}),
        x: event.clientX,
        y: event.clientY
      });
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "input",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? target
        : target instanceof HTMLSelectElement
          ? target
          : null;

      if (!field) {
        return;
      }

      const selector = describeElement(field);

      void sendInteraction({
        kind: "interaction",
        type: "input",
        ...(selector ? { selector } : {})
      });
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "submit",
    (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      const selector = describeElement(form);

      void sendInteraction({
        kind: "interaction",
        type: "submit",
        ...(selector ? { selector } : {})
      });
    },
    { capture: true, passive: true }
  );

  window.addEventListener("popstate", () => {
    void announceNavigation();
  });

  window.addEventListener("hashchange", () => {
    void announceNavigation();
  });

  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");
}

async function announceContentReady(sessionId: string): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "jl/content-ready",
    sessionId,
    page: {
      url: sanitizeCapturedUrl(window.location.href),
      title: document.title || window.location.href
    }
  });
}

async function announceNavigation(): Promise<void> {
  await sendInteraction({
    kind: "interaction",
    type: "navigation",
    selector: sanitizeCapturedUrl(window.location.href)
  });

  if (activeSessionId) {
    await announceContentReady(activeSessionId);
  }
}

async function sendInteraction(payload: {
  kind: "interaction";
  type: "click" | "input" | "submit" | "navigation";
  selector?: string | undefined;
  valuePreview?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
}): Promise<void> {
  if (!activeSessionId) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "jl/interaction",
    sessionId: activeSessionId,
    payload
  });
}

function patchHistoryMethod(methodName: "pushState" | "replaceState"): void {
  const original = history[methodName];

  history[methodName] = function patchedHistoryMethod(...args) {
    const result = original.apply(this, args);
    void announceNavigation();
    return result;
  };
}

function describeElement(element: Element | null): string | undefined {
  if (!element) {
    return undefined;
  }

  const segments: string[] = [];
  let current: Element | null = element;

  while (current && segments.length < 4) {
    const tagName = current.tagName.toLowerCase();
    const inputType = current instanceof HTMLInputElement && current.type ? `:${current.type}` : "";

    segments.unshift(`${tagName}${inputType}`);
    current = current.parentElement;
  }

  return segments.join(" > ");
}

declare global {
  interface Window {
    __jittleLampBootstrapped__?: boolean;
  }
}

bootContentBridge();

export {};
