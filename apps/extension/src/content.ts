import { backgroundToContentMessageSchema, sanitizeCapturedUrl } from "@jittle-lamp/shared";

let activeSessionId: string | null = null;

type NetworkProbeBody = {
  disposition: "captured" | "truncated" | "omitted" | "unavailable";
  encoding?: "utf8";
  mimeType?: string;
  value?: string;
  byteLength?: number;
  omittedByteLength?: number;
  reason?: string;
};

type NetworkProbePayload = {
  requestId: string;
  method: string;
  url: string;
  subtype: "xhr" | "fetch";
  status?: number;
  statusText?: string;
  durationMs?: number;
  requestHeaders: Array<{ name: string; value: string }>;
  responseHeaders: Array<{ name: string; value: string }>;
  requestBody?: NetworkProbeBody;
  responseBody?: NetworkProbeBody;
  failureText?: string;
};

function bootContentBridge(): void {
  if (window.__jittleLampBootstrapped__) {
    return;
  }

  window.__jittleLampBootstrapped__ = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !isNetworkProbeMessage(event.data)) {
      return;
    }

    void sendNetworkEvent(event.data.payload);
  });

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
      const descriptor = describeElementTarget(target);
      const page = collectPageMetrics();

      void sendInteraction({
        kind: "interaction",
        type: "click",
        ...(descriptor.selector ? { selector: descriptor.selector } : {}),
        ...(descriptor.target ? { target: descriptor.target } : {}),
        page,
        x: event.clientX,
        y: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        button: event.button,
        buttons: event.buttons,
        clickCount: event.detail,
        modifiers: collectModifierState(event),
        ...(event instanceof PointerEvent && event.pointerType ? { pointerType: normalizePointerType(event.pointerType) } : {})
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

      const descriptor = describeElementTarget(field);
      const snapshot = snapshotFieldValue(field);

      void sendInteraction({
        kind: "interaction",
        type: "input",
        ...(descriptor.selector ? { selector: descriptor.selector } : {}),
        ...(descriptor.target ? { target: descriptor.target } : {}),
        page: collectPageMetrics(),
        ...snapshot
      });
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (shouldSkipKeyboardEvent(event)) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const descriptor = describeElementTarget(target);
      const keyInfo = snapshotKeyboardEvent(event, target);

      void sendInteraction({
        kind: "interaction",
        type: "keyboard",
        ...(descriptor.selector ? { selector: descriptor.selector } : {}),
        ...(descriptor.target ? { target: descriptor.target } : {}),
        page: collectPageMetrics(),
        eventType: "keydown",
        ...keyInfo
      });
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "keyup",
    (event) => {
      if (shouldSkipKeyboardEvent(event)) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const descriptor = describeElementTarget(target);
      const keyInfo = snapshotKeyboardEvent(event, target);

      void sendInteraction({
        kind: "interaction",
        type: "keyboard",
        ...(descriptor.selector ? { selector: descriptor.selector } : {}),
        ...(descriptor.target ? { target: descriptor.target } : {}),
        page: collectPageMetrics(),
        eventType: "keyup",
        ...keyInfo
      });
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "submit",
    (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      const descriptor = describeElementTarget(form);
      const submitter = event instanceof SubmitEvent && event.submitter instanceof Element
        ? describeElementTarget(event.submitter)
        : { selector: undefined };

      void sendInteraction({
        kind: "interaction",
        type: "submit",
        ...(descriptor.selector ? { selector: descriptor.selector } : {}),
        ...(descriptor.target ? { target: descriptor.target } : {}),
        page: collectPageMetrics(),
        ...(descriptor.selector ? { formSelector: descriptor.selector } : {}),
        ...(submitter.selector ? { submitterSelector: submitter.selector } : {}),
        method: form?.method?.toLowerCase() || undefined,
        action: form?.action ? sanitizeCapturedUrl(form.action) : undefined
      });
    },
    { capture: true, passive: true }
  );

  window.addEventListener("popstate", () => {
    void announceNavigation("popstate");
  });

  window.addEventListener("hashchange", () => {
    void announceNavigation("hashchange");
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

async function announceNavigation(navigationType: "pushState" | "replaceState" | "popstate" | "hashchange" | "location"): Promise<void> {
  const url = sanitizeCapturedUrl(window.location.href);
  await sendInteraction({
    kind: "interaction",
    type: "navigation",
    selector: url,
    url,
    title: document.title || window.location.href,
    navigationType,
    page: collectPageMetrics()
  });

  if (activeSessionId) {
    await announceContentReady(activeSessionId);
  }
}

async function sendInteraction(payload: Record<string, unknown>): Promise<void> {
  if (!activeSessionId) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "jl/interaction",
    sessionId: activeSessionId,
    payload
  });
}

async function sendNetworkEvent(payload: NetworkProbePayload): Promise<void> {
  if (!activeSessionId) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "jl/network",
    sessionId: activeSessionId,
    payload: {
      kind: "network",
      method: payload.method,
      url: sanitizeCapturedUrl(payload.url),
      subtype: payload.subtype,
      ...(typeof payload.status === "number" ? { status: payload.status } : {}),
      ...(payload.statusText ? { statusText: payload.statusText } : {}),
      ...(typeof payload.durationMs === "number" ? { durationMs: payload.durationMs } : {}),
      ...(payload.requestId ? { requestId: payload.requestId } : {}),
      request: {
        headers: payload.requestHeaders,
        cookies: [],
        ...(payload.requestBody ? { body: payload.requestBody } : {})
      },
      ...(payload.responseHeaders.length > 0 || payload.responseBody
        ? {
            response: {
              headers: payload.responseHeaders,
              setCookieHeaders: [],
              setCookies: [],
              ...(payload.responseBody ? { body: payload.responseBody } : {})
            }
          }
        : {}),
      ...(payload.failureText ? { failureText: payload.failureText } : {})
    }
  });
}

function isNetworkProbeMessage(value: unknown): value is { source: "jittle-lamp-network-probe"; payload: NetworkProbePayload } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { source?: unknown; payload?: unknown };
  const payload = candidate.payload as Partial<NetworkProbePayload> | undefined;

  return (
    candidate.source === "jittle-lamp-network-probe" &&
    Boolean(payload) &&
    typeof payload?.method === "string" &&
    typeof payload.url === "string" &&
    Array.isArray(payload.requestHeaders) &&
    Array.isArray(payload.responseHeaders)
  );
}

function patchHistoryMethod(methodName: "pushState" | "replaceState"): void {
  const original = history[methodName];

  history[methodName] = function patchedHistoryMethod(...args) {
    const result = original.apply(this, args);
    void announceNavigation(methodName);
    return result;
  };
}

function describeElement(element: Element | null): string | undefined {
  if (!element) {
    return undefined;
  }

  const testId = getTestId(element);
  if (testId) {
    return `[${testId.attribute}="${escapeAttributeValue(testId.value)}"]`;
  }

  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  return buildRelativeDomSelector(element);
}

function buildRelativeDomSelector(element: Element): string | undefined {
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement && segments.length < 5) {
    segments.unshift(buildRelativeSegment(current));
    current = current.parentElement;
  }

  return segments.join(" > ") || undefined;
}

function buildRelativeSegment(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  const inputType = element instanceof HTMLInputElement && element.type ? `[type="${escapeAttributeValue(element.type)}"]` : "";
  const parent = element.parentElement;

  if (!parent) {
    return `${tagName}${inputType}`;
  }

  const sameTagSiblings = Array.from(parent.children).filter((sibling) => sibling.tagName === element.tagName);

  if (sameTagSiblings.length <= 1) {
    return `${tagName}${inputType}`;
  }

  const position = sameTagSiblings.indexOf(element) + 1;
  return `${tagName}${inputType}:nth-of-type(${position})`;
}

function describeElementTarget(element: Element | null): {
  selector?: string;
  target?: {
    selector?: string;
    selectorAlternates: string[];
    tagName?: string;
    dataTestId?: string;
    id?: string;
    name?: string;
    role?: string | null;
    href?: string;
    textPreview?: string;
    inputType?: string;
    rect?: { left: number; top: number; width: number; height: number };
  };
} {
  if (!element) {
    return {};
  }

  const selector = describeElement(element);
  const selectorAlternates = buildSelectorAlternates(element, selector);
  const rect = element.getBoundingClientRect();
  const textPreview = describeElementText(element);
  const href = element instanceof HTMLAnchorElement && element.href ? sanitizeCapturedUrl(element.href) : undefined;
  const inputType = element instanceof HTMLInputElement && element.type ? element.type : undefined;
  const testId = getTestId(element)?.value;

  return {
    ...(selector ? { selector } : {}),
    target: {
      ...(selector ? { selector } : {}),
      selectorAlternates,
      tagName: element.tagName.toLowerCase(),
      ...(testId ? { dataTestId: testId } : {}),
      ...(element.id ? { id: element.id } : {}),
      ...(element.getAttribute("name") ? { name: element.getAttribute("name")! } : {}),
      role: element.getAttribute("role"),
      ...(href ? { href } : {}),
      ...(textPreview ? { textPreview } : {}),
      ...(inputType ? { inputType } : {}),
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      }
    }
  };
}

function buildSelectorAlternates(element: Element, primarySelector?: string): string[] {
  const alternates = new Set<string>();

  const testId = element.getAttribute("data-testid") || element.getAttribute("data-test-id");
  if (testId) {
    const attribute = element.hasAttribute("data-testid") ? "data-testid" : "data-test-id";
    alternates.add(`[${attribute}="${escapeAttributeValue(testId)}"]`);
  }

  if (element.id) {
    alternates.add(`#${cssEscape(element.id)}`);
  }

  if (primarySelector) {
    alternates.add(primarySelector);
  }

  const name = element.getAttribute("name");
  if (name) {
    alternates.add(`${element.tagName.toLowerCase()}[name="${escapeAttributeValue(name)}"]`);
  }

  return Array.from(alternates).slice(0, 6);
}

function getTestId(element: Element): { attribute: "data-testid" | "data-test-id"; value: string } | undefined {
  const dataTestId = element.getAttribute("data-testid");

  if (dataTestId) {
    return { attribute: "data-testid", value: dataTestId };
  }

  const dataTestDashId = element.getAttribute("data-test-id");

  if (dataTestDashId) {
    return { attribute: "data-test-id", value: dataTestDashId };
  }

  return undefined;
}

function describeElementText(element: Element): string | undefined {
  const candidates = [
    element.getAttribute("aria-label"),
    element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type) ? element.value : undefined,
    element.textContent,
    element.getAttribute("title"),
    element.getAttribute("alt"),
    element.getAttribute("placeholder")
  ];

  for (const candidate of candidates) {
    const normalized = candidate?.trim().replace(/\s+/g, " ").slice(0, 240);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function collectPageMetrics() {
  const documentElement = document.documentElement;
  const body = document.body;

  return {
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    document: {
      width: Math.max(documentElement?.scrollWidth ?? 0, body?.scrollWidth ?? 0, window.innerWidth),
      height: Math.max(documentElement?.scrollHeight ?? 0, body?.scrollHeight ?? 0, window.innerHeight)
    },
    scroll: {
      x: window.scrollX,
      y: window.scrollY
    },
    devicePixelRatio: window.devicePixelRatio,
    url: sanitizeCapturedUrl(window.location.href),
    ...(document.title ? { title: document.title } : {})
  };
}

function collectModifierState(event: MouseEvent | KeyboardEvent) {
  return {
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey
  };
}

function snapshotFieldValue(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const redacted = isSensitiveField(field);
  const inputKind = inferInputKind(field);
  const stringValue = "value" in field ? String(field.value ?? "") : "";

  return {
    inputType: undefined,
    inputKind,
    valuePreview: redacted ? `[redacted ${stringValue.length} chars]` : stringValue.slice(0, 240),
    ...(redacted ? { redacted: true } : { value: stringValue }),
    valueLength: stringValue.length,
    ...(field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio") ? { checked: field.checked } : {}),
    ...(field instanceof HTMLSelectElement ? { selectedIndex: field.selectedIndex } : {}),
    ...((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && typeof field.selectionStart === "number" ? { selectionStart: field.selectionStart } : {}),
    ...((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && typeof field.selectionEnd === "number" ? { selectionEnd: field.selectionEnd } : {}),
    ...(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? { isComposing: false } : {})
  };
}

function snapshotKeyboardEvent(event: KeyboardEvent, target: Element | null) {
  const redacted = isSensitiveField(target);
  const printable = event.key.length === 1;

  return {
    key: redacted && printable ? "[redacted]" : event.key,
    ...(event.code ? { code: event.code } : {}),
    location: event.location,
    repeat: event.repeat,
    isComposing: event.isComposing,
    ...(redacted && printable ? { redacted: true } : {}),
    modifiers: collectModifierState(event)
  };
}

function shouldSkipKeyboardEvent(event: KeyboardEvent): boolean {
  if (event.key === "Unidentified") {
    return true;
  }

  return ["Alt", "Control", "Meta", "Shift"].includes(event.key);
}

function normalizePointerType(pointerType: string): "mouse" | "pen" | "touch" | undefined {
  return pointerType === "mouse" || pointerType === "pen" || pointerType === "touch" ? pointerType : undefined;
}

function inferInputKind(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): "text" | "textarea" | "select" | "checkbox" | "radio" | "contenteditable" | "other" {
  if (field instanceof HTMLTextAreaElement) return "textarea";
  if (field instanceof HTMLSelectElement) return "select";
  if (field.type === "checkbox") return "checkbox";
  if (field.type === "radio") return "radio";
  return "text";
}

function isSensitiveField(target: Element | null): boolean {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return false;
  }

  if (target instanceof HTMLInputElement) {
    if (["password", "email", "tel", "search"].includes(target.type)) {
      return true;
    }
  }

  const probe = [target.getAttribute("name"), target.id, target.getAttribute("autocomplete")].filter(Boolean).join(" ").toLowerCase();
  return /(pass|pwd|secret|token|otp|code|ssn|card|cvv)/.test(probe);
}

declare global {
  interface Window {
    __jittleLampBootstrapped__?: boolean;
  }
}

bootContentBridge();

export {};
