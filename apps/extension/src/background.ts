import {
  appendDraftEvent,
  captureSessionDraftSchema,
  contentRuntimeMessageSchema,
  createSessionBundle,
  createSessionDraft,
  offscreenResponseSchema,
  popupRequestSchema,
  sanitizeCapturedUrl,
  transitionDraftPhase,
  updateDraftPage,
  type CaptureSessionDraft,
  type PopupResponse,
  type PopupSessionSummary,
  type PopupState
} from "@jittle-lamp/shared";

const sessionStorageKey = "jittle-lamp.active-session";
const debuggerProtocolVersion = "1.3";
const offscreenDocumentPath = "offscreen.html";
const networkBodyCaptureByteLimit = 64 * 1024;
const networkBodyFetchByteLimit = 512 * 1024;

const networkRequestsByTab = new Map<number, Map<string, NetworkRequestState>>();
const stoppingTabIds = new Set<number>();

let draftMutationQueue = Promise.resolve();
let offscreenCreationPromise: Promise<void> | null = null;

type NetworkRequestState = {
  hasBaseRequest?: boolean;
  method: string;
  url: string;
  startedAtMs: number;
  status?: number;
  statusText?: string;
  requestHeaders?: NetworkHeaderEntry[];
  requestCookies?: NetworkAssociatedCookie[];
  requestHasPostData?: boolean;
  responseHeaders?: NetworkHeaderEntry[];
  responseSetCookieHeaders?: string[];
  responseSetCookies?: NetworkSetCookie[];
  responseMimeType?: string;
  failureText?: string;
};

type NetworkHeaderEntry = {
  name: string;
  value: string;
};

type NetworkCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  size?: number;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  sameSite?: string;
  priority?: string;
  sameParty?: boolean;
  sourcePort?: number;
  sourceScheme?: string;
  partitionKey?: string;
  partitioned?: boolean;
};

type NetworkAssociatedCookie = {
  cookie: NetworkCookie;
  blockedReasons: string[];
};

type NetworkSetCookie = NetworkCookie & {
  raw: string;
};

type NetworkBodyCapture = {
  disposition: "captured" | "truncated" | "omitted" | "unavailable";
  encoding?: "utf8" | "base64";
  mimeType?: string;
  value?: string;
  byteLength?: number;
  omittedByteLength?: number;
  reason?: string;
};

type CdpRemoteObject = {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  unserializableValue?: string;
  className?: string;
};

type CdpRequestWillBeSentParams = {
  requestId?: string;
  redirectResponse?: CdpResponseMetadata;
  request?: {
    method?: string;
    url?: string;
    headers?: CdpHeaders;
    hasPostData?: boolean;
  };
};

type CdpRequestWillBeSentExtraInfoParams = {
  requestId?: string;
  headers?: CdpHeaders;
  associatedCookies?: Array<{
    blockedReasons?: string[];
    cookie?: CdpCookie;
  }>;
};

type CdpResponseReceivedParams = {
  requestId?: string;
  response?: CdpResponseMetadata;
};

type CdpResponseReceivedExtraInfoParams = {
  requestId?: string;
  headers?: CdpHeaders;
  headersText?: string;
};

type CdpLoadingFinishedParams = {
  requestId?: string;
};

type CdpLoadingFailedParams = {
  requestId?: string;
  errorText?: string;
};

type CdpHeaders = Record<string, unknown>;

type CdpResponseMetadata = {
  status?: number;
  statusText?: string;
  headers?: CdpHeaders;
  mimeType?: string;
};

type CdpCookie = {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: number;
  size?: number;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  sameSite?: string;
  priority?: string;
  sameParty?: boolean;
  sourcePort?: number;
  sourceScheme?: string;
  partitionKey?: string;
  partitioned?: boolean;
};

type CdpRequestPostDataResult = {
  postData?: string;
};

type CdpResponseBodyResult = {
  body?: string;
  base64Encoded?: boolean;
};

type CdpConsoleCalledParams = {
  type?: string;
  args?: CdpRemoteObject[];
};

type CdpExceptionThrownParams = {
  exceptionDetails?: {
    text?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    exception?: CdpRemoteObject;
  };
};

chrome.runtime.onInstalled.addListener(() => {
  console.info("jittle-lamp recorder installed.");
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  void handleIncomingMessage(rawMessage, sender)
    .then((response) => {
      if (response !== undefined) {
        sendResponse(response);
      }
    })
    .catch((error: unknown) => {
      const message = errorMessage(error);
      console.error(message);
      void buildPopupResponse(false, message).then((response) => sendResponse(response));
    });

  return true;
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  void queueDraftMutation(() => handleDebuggerEvent(source, method, params));
});

chrome.debugger.onDetach.addListener((source, reason) => {
  void queueDraftMutation(() => handleDebuggerDetach(source, reason));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  void queueDraftMutation(() => handleCompletedTabUpdate(tabId));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void queueDraftMutation(() => autoStopIfCapturedTabCloses(tabId));
});

async function handleIncomingMessage(
  rawMessage: unknown,
  sender: chrome.runtime.MessageSender
): Promise<unknown | undefined> {
  const popupRequest = popupRequestSchema.safeParse(rawMessage);

  if (popupRequest.success) {
    switch (popupRequest.data.type) {
      case "jl/popup-get-state":
        return buildPopupResponse(true);

      case "jl/popup-start-recording":
        return queueDraftMutation(async () => {
          try {
            await startRecordingSession();
            return buildPopupResponse(true);
          } catch (error: unknown) {
            return buildPopupResponse(false, errorMessage(error));
          }
        });

      case "jl/popup-stop-recording":
        return queueDraftMutation(async () => {
          try {
            await stopRecordingSession("Stopped recording from the popup.");
            return buildPopupResponse(true);
          } catch (error: unknown) {
            return buildPopupResponse(false, errorMessage(error));
          }
        });
    }
  }

  const contentMessage = contentRuntimeMessageSchema.safeParse(rawMessage);

  if (contentMessage.success) {
    await queueDraftMutation(() => handleContentRuntimeMessage(contentMessage.data, sender));
    return { ok: true };
  }

  return undefined;
}

async function startRecordingSession(): Promise<void> {
  const existingDraft = await readDraft();

  if (existingDraft && isSessionBusy(existingDraft)) {
    throw new Error("A jittle-lamp session is already active.");
  }

  if (existingDraft && !isSessionBusy(existingDraft)) {
    await clearDraft();
  }

  const tab = await getActiveTab();
  const draft = createSessionDraft({
    page: {
      tabId: tab.id,
      title: tab.title ?? tab.url,
      url: tab.url
    }
  });

  await saveDraft(draft);

  try {
    await ensureOffscreenDocument();
    await ensureContentBridge(tab.id, draft.sessionId);
    await attachDebugger(tab.id);

    const streamId = await getTabMediaStreamId(tab.id);

    const offscreenResponse = offscreenResponseSchema.parse(
      await chrome.runtime.sendMessage({
        type: "jl/offscreen-start-recording",
        sessionId: draft.sessionId,
        tabId: tab.id,
        streamId
      })
    );

    if (!offscreenResponse.ok) {
      throw new Error(offscreenResponse.error ?? "Offscreen recorder failed to start.");
    }

    await saveDraft(
      transitionDraftPhase(
        draft,
        "recording",
        "Started active-tab recording in the offscreen document."
      )
    );
  } catch (error: unknown) {
    await saveDraft(
      transitionDraftPhase(draft, "failed", `Failed to start recording: ${errorMessage(error)}`)
    );

    await signalContentCaptureEnded(tab.id, draft.sessionId);
    await safeDetachDebugger(tab.id);
    await closeOffscreenDocumentIfPresent();

    throw error;
  }
}

async function stopRecordingSession(detail: string): Promise<void> {
  const currentDraft = await readDraft();

  if (!currentDraft) {
    return;
  }

  if (currentDraft.phase !== "armed" && currentDraft.phase !== "recording") {
    return;
  }

  const tabId = currentDraft.page.tabId;

  if (typeof tabId !== "number") {
    throw new Error("The active session is missing its tab identifier.");
  }

  const processingDraft = transitionDraftPhase(currentDraft, "processing", detail);
  await saveDraft(processingDraft);

  try {
    stoppingTabIds.add(tabId);
    await signalContentCaptureEnded(tabId, processingDraft.sessionId);
    await safeDetachDebugger(tabId);

    const readyDraft = transitionDraftPhase(
      processingDraft,
      "ready",
      "Queued local WebM and JSON exports."
    );

    const offscreenResponse = offscreenResponseSchema.parse(
      await chrome.runtime.sendMessage({
        type: "jl/offscreen-stop-and-export",
        sessionId: readyDraft.sessionId,
        bundle: createSessionBundle(readyDraft)
      })
    );

    if (!offscreenResponse.ok) {
      throw new Error(offscreenResponse.error ?? "Offscreen export failed.");
    }

    await clearDraft();
  } catch (error: unknown) {
    await saveDraft(
      transitionDraftPhase(
        processingDraft,
        "failed",
        `Failed to finalize recording: ${errorMessage(error)}`
      )
    );

    throw error;
  } finally {
    stoppingTabIds.delete(tabId);
    networkRequestsByTab.delete(tabId);
    await closeOffscreenDocumentIfPresent();
  }
}

async function autoStopIfCapturedTabCloses(tabId: number): Promise<void> {
  const draft = await readDraft();

  if (!draft || draft.page.tabId !== tabId || draft.phase !== "recording") {
    return;
  }

  await stopRecordingSession("Captured tab closed; exported the partial session.");
}

async function handleCompletedTabUpdate(tabId: number): Promise<void> {
  const draft = await readDraft();

  if (!draft || draft.page.tabId !== tabId) {
    return;
  }

  if (draft.phase !== "armed" && draft.phase !== "recording") {
    return;
  }

  const tab = await chrome.tabs.get(tabId);

  if (!tab.url || !isHttpUrl(tab.url)) {
    return;
  }

  const sanitizedUrl = sanitizeCapturedUrl(tab.url);
  let nextDraft = draft;

  if (draft.page.url !== sanitizedUrl || draft.page.title !== (tab.title ?? sanitizedUrl)) {
    nextDraft = appendDraftEvent(
      updateDraftPage(draft, {
        tabId,
        title: tab.title ?? sanitizedUrl,
        url: sanitizedUrl
      }),
      {
        kind: "interaction",
        type: "navigation",
        selector: sanitizedUrl
      }
    );
    await saveDraft(nextDraft);
  }

  await ensureContentBridge(tabId, nextDraft.sessionId);
}

async function handleContentRuntimeMessage(
  message: ReturnType<typeof contentRuntimeMessageSchema.parse>,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const currentDraft = await readDraft();

  if (!currentDraft) {
    return;
  }

  if (message.sessionId !== currentDraft.sessionId) {
    return;
  }

  const senderTabId = sender.tab?.id;

  if (typeof senderTabId === "number" && currentDraft.page.tabId !== senderTabId) {
    return;
  }

  switch (message.type) {
    case "jl/content-ready": {
      const nextDraft = appendDraftEvent(
        updateDraftPage(
          currentDraft,
          currentDraft.page.tabId === undefined
            ? {
                title: message.page.title,
                url: message.page.url
              }
            : {
                tabId: currentDraft.page.tabId,
                title: message.page.title,
                url: message.page.url
              }
        ),
        {
          kind: "lifecycle",
          phase: currentDraft.phase,
          detail: `Content capture ready on ${message.page.url}`
        }
      );

      await saveDraft(nextDraft);
      return;
    }

    case "jl/interaction":
      await saveDraft(appendDraftEvent(currentDraft, message.payload));
      return;
  }
}

async function handleDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params: unknown
): Promise<void> {
  const tabId = source.tabId;

  if (typeof tabId !== "number") {
    return;
  }

  const currentDraft = await readDraft();

  if (!currentDraft || currentDraft.page.tabId !== tabId || currentDraft.phase !== "recording") {
    return;
  }

  switch (method) {
    case "Network.requestWillBeSent": {
      const payload = params as CdpRequestWillBeSentParams;
      const requestId = payload.requestId;
      const requestUrl = payload.request?.url;
      const requestMethod = payload.request?.method;

      if (!requestId || !requestUrl || !requestMethod || !isHttpUrl(requestUrl)) {
        return;
      }

      const existingRequestState = getNetworkRequests(tabId).get(requestId);
      let nextDraft = currentDraft;

      if (existingRequestState?.hasBaseRequest && payload.redirectResponse) {
        applyResponseMetadata(existingRequestState, payload.redirectResponse);

        const { requestBody, responseBody } = await captureNetworkBodies(
          tabId,
          requestId,
          existingRequestState,
          false
        );

        nextDraft = appendDraftEvent(
          nextDraft,
          buildNetworkEventPayload({
            requestState: existingRequestState,
            requestId,
            durationMs: Date.now() - existingRequestState.startedAtMs,
            ...(requestBody ? { requestBody } : {}),
            ...(responseBody ? { responseBody } : {})
          })
        );
      }

      const requestState = createNetworkRequestState(existingRequestState?.hasBaseRequest ? undefined : existingRequestState);

      requestState.hasBaseRequest = true;
      requestState.method = requestMethod;
      requestState.url = requestUrl;
      requestState.startedAtMs = Date.now();

      if (typeof payload.request?.hasPostData === "boolean") {
        requestState.requestHasPostData = payload.request.hasPostData;
      }

      if (!requestState.requestHeaders?.length) {
        requestState.requestHeaders = headerEntriesFromHeaders(payload.request?.headers);
      }

      getNetworkRequests(tabId).set(requestId, requestState);

      if (nextDraft !== currentDraft) {
        await saveDraft(nextDraft);
      }

      return;
    }

    case "Network.requestWillBeSentExtraInfo": {
      const payload = params as CdpRequestWillBeSentExtraInfoParams;
      const requestId = payload.requestId;

      if (!requestId) {
        return;
      }

      const requestState = getOrCreateNetworkRequestState(tabId, requestId);
      requestState.requestHeaders = headerEntriesFromHeaders(payload.headers);
      requestState.requestCookies = (payload.associatedCookies ?? [])
        .map((entry) => toAssociatedCookie(entry.cookie, entry.blockedReasons))
        .filter((entry): entry is NetworkAssociatedCookie => entry !== null);
      return;
    }

    case "Network.responseReceived": {
      const payload = params as CdpResponseReceivedParams;
      const requestId = payload.requestId;
      const status = payload.response?.status;

      if (!requestId || typeof status !== "number") {
        return;
      }

      const requestState = getNetworkRequests(tabId).get(requestId);

      if (requestState) {
        applyResponseMetadata(requestState, payload.response);
      }
      return;
    }

    case "Network.responseReceivedExtraInfo": {
      const payload = params as CdpResponseReceivedExtraInfoParams;
      const requestId = payload.requestId;

      if (!requestId) {
        return;
      }

      const requestState = getOrCreateNetworkRequestState(tabId, requestId);
      const responseHeaders = headerEntriesFromHeaders(payload.headers, payload.headersText);

      requestState.responseHeaders = responseHeaders;
      requestState.responseSetCookieHeaders = setCookieHeadersFromEntries(responseHeaders);
      requestState.responseSetCookies = requestState.responseSetCookieHeaders.map(parseSetCookieHeader);
      return;
    }

    case "Network.loadingFinished": {
      const payload = params as CdpLoadingFinishedParams;
      const requestId = payload.requestId;

      if (!requestId) {
        return;
      }

      const requestState = getNetworkRequests(tabId).get(requestId);

      if (!requestState) {
        return;
      }

      if (!requestState.hasBaseRequest) {
        getNetworkRequests(tabId).delete(requestId);
        return;
      }

      const { requestBody, responseBody } = await captureNetworkBodies(tabId, requestId, requestState, true);
      getNetworkRequests(tabId).delete(requestId);
      await saveDraft(
        appendDraftEvent(
          currentDraft,
          buildNetworkEventPayload({
            requestState,
            requestId,
            durationMs: Date.now() - requestState.startedAtMs,
            ...(requestBody ? { requestBody } : {}),
            ...(responseBody ? { responseBody } : {})
          })
        )
      );
      return;
    }

    case "Network.loadingFailed": {
      const payload = params as CdpLoadingFailedParams;
      const requestId = payload.requestId;

      if (!requestId) {
        return;
      }

      const requestState = getNetworkRequests(tabId).get(requestId);
      getNetworkRequests(tabId).delete(requestId);

      if (!requestState) {
        return;
      }

      if (!requestState.hasBaseRequest) {
        return;
      }

      requestState.failureText = payload.errorText || `Network request failed for ${requestState.url}`;
      const { requestBody, responseBody } = await captureNetworkBodies(tabId, requestId, requestState, false);
      const failedDraft = appendDraftEvent(
        currentDraft,
        buildNetworkEventPayload({
          requestState,
          requestId,
          durationMs: Date.now() - requestState.startedAtMs,
          ...(requestBody ? { requestBody } : {}),
          ...(responseBody ? { responseBody } : {})
        })
      );

      await saveDraft(
        appendDraftEvent(failedDraft, {
          kind: "error",
          message: requestState.failureText,
          source: "runtime"
        })
      );
      return;
    }

    case "Runtime.consoleAPICalled": {
      const payload = params as CdpConsoleCalledParams;

      await saveDraft(
        appendDraftEvent(currentDraft, {
          kind: "console",
          level: toConsoleLevel(payload.type),
          message: sanitizeCapturedText(stringifyConsoleArgs(payload.args).join(" ").trim()),
          args: []
        })
      );
      return;
    }

    case "Runtime.exceptionThrown": {
      const payload = params as CdpExceptionThrownParams;
      const details = payload.exceptionDetails;

      if (!details) {
        return;
      }

      const message = [
        details.text,
        details.url ? `(${details.url}:${(details.lineNumber ?? 0) + 1}:${(details.columnNumber ?? 0) + 1})` : undefined
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" ");

      await saveDraft(
        appendDraftEvent(currentDraft, {
          kind: "error",
          message: sanitizeCapturedText(message || details.exception?.description || "Runtime exception thrown."),
          source: "runtime"
        })
      );
      return;
    }
  }
}

async function handleDebuggerDetach(
  source: chrome.debugger.Debuggee,
  reason: string
): Promise<void> {
  const tabId = source.tabId;

  if (typeof tabId !== "number") {
    return;
  }

  networkRequestsByTab.delete(tabId);

  if (stoppingTabIds.has(tabId)) {
    return;
  }

  const draft = await readDraft();

  if (!draft || draft.page.tabId !== tabId || draft.phase !== "recording") {
    return;
  }

  await saveDraft(
    transitionDraftPhase(
      appendDraftEvent(draft, {
        kind: "error",
        message: `Debugger detached unexpectedly: ${reason}`,
        source: "extension"
      }),
      "failed",
      "Stopped recording because the Chrome debugger detached unexpectedly."
    )
  );

  await signalContentCaptureEnded(tabId, draft.sessionId);
  await closeOffscreenDocumentIfPresent();
}

async function ensureContentBridge(tabId: number, sessionId: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });

  await chrome.tabs.sendMessage(tabId, {
    type: "jl/content-begin-capture",
    sessionId
  });
}

async function signalContentCaptureEnded(tabId: number, sessionId: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "jl/content-end-capture",
      sessionId
    });
  } catch (error: unknown) {
    const message = errorMessage(error);

    if (!message.includes("Receiving end does not exist")) {
      console.warn(message);
    }
  }
}

async function attachDebugger(tabId: number): Promise<void> {
  const debuggee = { tabId };

  await chrome.debugger.attach(debuggee, debuggerProtocolVersion);
  await chrome.debugger.sendCommand(debuggee, "Network.enable");
  await chrome.debugger.sendCommand(debuggee, "Runtime.enable");
  await chrome.debugger.sendCommand(debuggee, "Page.enable");
}

async function safeDetachDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.detach({ tabId });
  } catch (error: unknown) {
    const message = errorMessage(error);

    if (!message.includes("Detached while handling command") && !message.includes("No target with given id")) {
      console.warn(message);
    }
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (!offscreenCreationPromise) {
    offscreenCreationPromise = chrome.offscreen
      .createDocument({
        url: offscreenDocumentPath,
        reasons: ["USER_MEDIA", "BLOBS"],
        justification: "Record the active tab and export the local session bundle."
      })
      .finally(() => {
        offscreenCreationPromise = null;
      });
  }

  await offscreenCreationPromise;
}

async function closeOffscreenDocumentIfPresent(): Promise<void> {
  if (!(await hasOffscreenDocument())) {
    return;
  }

  try {
    await chrome.offscreen.closeDocument();
  } catch (error: unknown) {
    console.warn(errorMessage(error));
  }
}

async function hasOffscreenDocument(): Promise<boolean> {
  const serviceWorker = globalThis as typeof globalThis & {
    clients: {
      matchAll: () => Promise<Array<{ url: string }>>;
    };
  };
  const allClients = await serviceWorker.clients.matchAll();
  const offscreenUrl = chrome.runtime.getURL(offscreenDocumentPath);

  return allClients.some((client) => client.url === offscreenUrl);
}

async function getActiveTab(): Promise<chrome.tabs.Tab & { id: number; url: string }> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];

  if (!activeTab?.id || !activeTab.url) {
    throw new Error("Open an http(s) page before starting jittle-lamp.");
  }

  if (!isHttpUrl(activeTab.url)) {
    throw new Error("jittle-lamp V1 only records active http(s) tabs.");
  }

  return activeTab as chrome.tabs.Tab & { id: number; url: string };
}

function getNetworkRequests(tabId: number): Map<string, NetworkRequestState> {
  const existing = networkRequestsByTab.get(tabId);

  if (existing) {
    return existing;
  }

  const created = new Map<string, NetworkRequestState>();
  networkRequestsByTab.set(tabId, created);
  return created;
}

function getOrCreateNetworkRequestState(tabId: number, requestId: string): NetworkRequestState {
  const requests = getNetworkRequests(tabId);
  const existing = requests.get(requestId);

  if (existing) {
    return existing;
  }

  const created = createNetworkRequestState();

  requests.set(requestId, created);
  return created;
}

function createNetworkRequestState(seed?: Pick<NetworkRequestState, "requestHeaders" | "requestCookies">): NetworkRequestState {
  return {
    method: "UNKNOWN",
    url: "https://invalid.jittle-lamp.local/unknown",
    startedAtMs: Date.now(),
    ...(seed?.requestHeaders ? { requestHeaders: seed.requestHeaders } : {}),
    ...(seed?.requestCookies ? { requestCookies: seed.requestCookies } : {})
  };
}

function applyResponseMetadata(requestState: NetworkRequestState, response?: CdpResponseMetadata): void {
  if (!response) {
    return;
  }

  const responseHeaders = headerEntriesFromHeaders(response.headers);

  if (typeof response.status === "number") {
    requestState.status = response.status;
  }

  if (response.statusText) {
    requestState.statusText = response.statusText;
  }

  if (response.mimeType) {
    requestState.responseMimeType = response.mimeType;
  }

  if (!requestState.responseHeaders?.length) {
    requestState.responseHeaders = responseHeaders;
  }

  if (!requestState.responseSetCookieHeaders?.length) {
    const setCookieHeaders = setCookieHeadersFromEntries(requestState.responseHeaders ?? responseHeaders);

    if (setCookieHeaders.length > 0) {
      requestState.responseSetCookieHeaders = setCookieHeaders;
      requestState.responseSetCookies = setCookieHeaders.map(parseSetCookieHeader);
    }
  }
}

function buildNetworkEventPayload(input: {
  requestState: NetworkRequestState;
  requestId: string;
  durationMs: number;
  requestBody?: NetworkBodyCapture | undefined;
  responseBody?: NetworkBodyCapture | undefined;
}) {
  const { requestState, requestId, durationMs, requestBody, responseBody } = input;

  return {
    kind: "network" as const,
    method: requestState.method,
    url: requestState.url,
    ...(typeof requestState.status === "number" ? { status: requestState.status } : {}),
    ...(requestState.statusText ? { statusText: requestState.statusText } : {}),
    durationMs,
    requestId,
    request: {
      headers: requestState.requestHeaders ?? [],
      cookies: requestState.requestCookies ?? [],
      ...(requestBody ? { body: requestBody } : {})
    },
    ...(hasResponseState(requestState, responseBody)
      ? {
          response: {
            headers: requestState.responseHeaders ?? [],
            setCookieHeaders: requestState.responseSetCookieHeaders ?? [],
            setCookies: requestState.responseSetCookies ?? [],
            ...(responseBody ? { body: responseBody } : {})
          }
        }
      : {}),
    ...(requestState.failureText ? { failureText: requestState.failureText } : {})
  };
}

async function captureNetworkBodies(
  tabId: number,
  requestId: string,
  requestState: NetworkRequestState,
  canCaptureResponseBody: boolean
): Promise<{
  requestBody?: NetworkBodyCapture;
  responseBody?: NetworkBodyCapture;
}> {
  const [requestBody, responseBody] = await Promise.all([
    captureRequestBody(tabId, requestId, requestState),
    captureResponseBody(tabId, requestId, requestState, canCaptureResponseBody)
  ]);

  return {
    ...(requestBody ? { requestBody } : {}),
    ...(responseBody ? { responseBody } : {})
  };
}

async function captureRequestBody(
  tabId: number,
  requestId: string,
  requestState: NetworkRequestState
): Promise<NetworkBodyCapture | undefined> {
  if (!shouldAttemptRequestBodyCapture(requestState)) {
    return undefined;
  }

  try {
    const result = (await chrome.debugger.sendCommand(
      { tabId },
      "Network.getRequestPostData",
      { requestId }
    )) as CdpRequestPostDataResult;
    const postData = result.postData ?? "";

    return createUtf8BodyCapture(postData, contentTypeFromHeaders(requestState.requestHeaders));
  } catch (error: unknown) {
    const message = errorMessage(error);
    const mimeType = contentTypeFromHeaders(requestState.requestHeaders);

    return {
      disposition: isMissingRequestPostDataError(message) ? "omitted" : "unavailable",
      ...(mimeType ? { mimeType } : {}),
      reason: isMissingRequestPostDataError(message)
        ? "Request did not expose post data through CDP."
        : message
    };
  }
}

async function captureResponseBody(
  tabId: number,
  requestId: string,
  requestState: NetworkRequestState,
  canCaptureResponseBody: boolean
): Promise<NetworkBodyCapture | undefined> {
  if (!hasResponseState(requestState)) {
    return undefined;
  }

  if (!canCaptureResponseBody) {
    const mimeType = requestState.responseMimeType;

    return {
      disposition: "unavailable",
      ...(mimeType ? { mimeType } : {}),
      reason: "Response body capture requires a completed Network.loadingFinished event."
    };
  }

  if (!responseMayHaveBody(requestState)) {
    const mimeType = requestState.responseMimeType;

    return {
      disposition: "omitted",
      ...(mimeType ? { mimeType } : {}),
      reason: "Response does not carry a body for this request."
    };
  }

  const declaredLength = declaredBodyLength(requestState.responseHeaders);

  if (declaredLength !== undefined && declaredLength > networkBodyFetchByteLimit) {
    const mimeType = requestState.responseMimeType;

    return {
      disposition: "omitted",
      ...(mimeType ? { mimeType } : {}),
      byteLength: declaredLength,
      omittedByteLength: declaredLength,
      reason: `Response body exceeded the ${networkBodyFetchByteLimit}-byte capture ceiling.`
    };
  }

  try {
    const result = (await chrome.debugger.sendCommand(
      { tabId },
      "Network.getResponseBody",
      { requestId }
    )) as CdpResponseBodyResult;

    return createBodyCapture({
      value: result.body ?? "",
      base64Encoded: result.base64Encoded ?? false,
      ...(requestState.responseMimeType ? { mimeType: requestState.responseMimeType } : {})
    });
  } catch (error: unknown) {
    const mimeType = requestState.responseMimeType;

    return {
      disposition: "unavailable",
      ...(mimeType ? { mimeType } : {}),
      reason: errorMessage(error)
    };
  }
}

function shouldAttemptRequestBodyCapture(requestState: NetworkRequestState): boolean {
  if (requestState.requestHasPostData) {
    return true;
  }

  switch (requestState.method.toUpperCase()) {
    case "POST":
    case "PUT":
    case "PATCH":
    case "DELETE":
      return true;

    default:
      return false;
  }
}

function createUtf8BodyCapture(value: string, mimeType?: string): NetworkBodyCapture {
  return createBodyCapture({
    value,
    base64Encoded: false,
    ...(mimeType ? { mimeType } : {})
  });
}

function createBodyCapture(input: {
  value: string;
  base64Encoded: boolean;
  mimeType?: string;
}): NetworkBodyCapture {
  if (input.base64Encoded) {
    const rawValue = input.value;
    const byteLength = estimateBase64ByteLength(rawValue);
    const maxBase64Length = Math.floor(networkBodyCaptureByteLimit / 3) * 4;

    if (byteLength <= networkBodyCaptureByteLimit || maxBase64Length <= 0) {
      return {
        disposition: "captured",
        encoding: "base64",
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
        value: rawValue,
        byteLength
      };
    }

    const truncatedValue = rawValue.slice(0, maxBase64Length - (maxBase64Length % 4));
    const capturedByteLength = estimateBase64ByteLength(truncatedValue);

    return {
      disposition: "truncated",
      encoding: "base64",
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      value: truncatedValue,
      byteLength,
      omittedByteLength: Math.max(0, byteLength - capturedByteLength),
      reason: `Body exceeded ${networkBodyCaptureByteLimit} bytes and was truncated locally.`
    };
  }

  const encoder = new TextEncoder();
  const encoded = encoder.encode(input.value);

  if (encoded.length <= networkBodyCaptureByteLimit) {
    return {
      disposition: "captured",
      encoding: "utf8",
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      value: input.value,
      byteLength: encoded.length
    };
  }

  const truncatedValue = new TextDecoder().decode(encoded.slice(0, networkBodyCaptureByteLimit));
  const truncatedByteLength = encoder.encode(truncatedValue).length;

  return {
    disposition: "truncated",
    encoding: "utf8",
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    value: truncatedValue,
    byteLength: encoded.length,
    omittedByteLength: Math.max(0, encoded.length - truncatedByteLength),
    reason: `Body exceeded ${networkBodyCaptureByteLimit} bytes and was truncated locally.`
  };
}

function estimateBase64ByteLength(value: string): number {
  const normalized = value.replace(/\s+/g, "");

  if (normalized.length === 0) {
    return 0;
  }

  const paddingLength = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - paddingLength);
}

function isMissingRequestPostDataError(message: string): boolean {
  return message.includes("No post data") || message.includes("does not have post data");
}

function responseMayHaveBody(requestState: NetworkRequestState): boolean {
  const status = requestState.status;

  if (status === undefined) {
    return true;
  }

  if (requestState.method.toUpperCase() === "HEAD") {
    return false;
  }

  return status !== 101 && status !== 204 && status !== 205 && status !== 304;
}

function hasResponseState(
  requestState: NetworkRequestState,
  responseBody?: NetworkBodyCapture
): boolean {
  return Boolean(
    responseBody ||
      requestState.status !== undefined ||
      requestState.statusText ||
      requestState.responseHeaders?.length ||
      requestState.responseSetCookieHeaders?.length ||
      requestState.responseSetCookies?.length ||
      requestState.responseMimeType
  );
}

function declaredBodyLength(headers: NetworkHeaderEntry[] | undefined): number | undefined {
  const contentLength = headerValue(headers, "content-length");

  if (!contentLength) {
    return undefined;
  }

  const parsed = Number.parseInt(contentLength, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function contentTypeFromHeaders(headers: NetworkHeaderEntry[] | undefined): string | undefined {
  return headerValue(headers, "content-type") || undefined;
}

function headerValue(headers: NetworkHeaderEntry[] | undefined, name: string): string | undefined {
  return headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value;
}

function headerEntriesFromHeaders(headers?: CdpHeaders, headersText?: string): NetworkHeaderEntry[] {
  const rawEntries = typeof headersText === "string" ? parseHeaderText(headersText) : [];

  if (rawEntries.length > 0) {
    return rawEntries;
  }

  return Object.entries(headers ?? {}).flatMap(([name, value]) => headerEntriesFromValue(name, value));
}

function parseHeaderText(headersText: string): NetworkHeaderEntry[] {
  const lines = headersText.split(/\r?\n/);
  const headerLines = lines[0]?.includes(":") ? lines : lines.slice(1);

  return headerLines
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const separatorIndex = line.indexOf(":");

      if (separatorIndex <= 0) {
        return [];
      }

      return [
        {
          name: line.slice(0, separatorIndex).trim(),
          value: line.slice(separatorIndex + 1).trim()
        }
      ];
    });
}

function headerEntriesFromValue(name: string, value: unknown): NetworkHeaderEntry[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => headerEntriesFromValue(name, entry));
  }

  if (typeof value === "string") {
    return value.split(/\r?\n/).filter(Boolean).map((entry) => ({ name, value: entry }));
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [{ name, value: String(value) }];
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [{ name, value: JSON.stringify(value) }];
}

function setCookieHeadersFromEntries(headers: NetworkHeaderEntry[]): string[] {
  return headers.filter((entry) => entry.name.toLowerCase() === "set-cookie").map((entry) => entry.value);
}

function parseSetCookieHeader(header: string): NetworkSetCookie {
  const segments = header.split(";").map((segment) => segment.trim()).filter(Boolean);
  const [nameValue = "", ...attributes] = segments;
  const separatorIndex = nameValue.indexOf("=");
  const name = separatorIndex >= 0 ? nameValue.slice(0, separatorIndex).trim() : nameValue.trim();
  const value = separatorIndex >= 0 ? nameValue.slice(separatorIndex + 1).trim() : "";
  const cookie: NetworkSetCookie = {
    raw: header,
    name: name || "set-cookie",
    value
  };

  for (const attribute of attributes) {
    const attributeSeparator = attribute.indexOf("=");
    const attributeName = (attributeSeparator >= 0 ? attribute.slice(0, attributeSeparator) : attribute)
      .trim()
      .toLowerCase();
    const attributeValue = attributeSeparator >= 0 ? attribute.slice(attributeSeparator + 1).trim() : "";

    switch (attributeName) {
      case "domain":
        cookie.domain = attributeValue;
        break;

      case "path":
        cookie.path = attributeValue;
        break;

      case "expires": {
        const expires = Date.parse(attributeValue);

        if (Number.isFinite(expires)) {
          cookie.expires = expires;
        }
        break;
      }

      case "httponly":
        cookie.httpOnly = true;
        break;

      case "secure":
        cookie.secure = true;
        break;

      case "samesite":
        cookie.sameSite = attributeValue;
        break;

      case "priority":
        cookie.priority = attributeValue;
        break;

      case "partitioned":
        cookie.partitioned = true;
        break;
    }
  }

  cookie.session = cookie.expires === undefined;
  return cookie;
}

function toAssociatedCookie(cookie: CdpCookie | undefined, blockedReasons?: string[]): NetworkAssociatedCookie | null {
  const normalizedCookie = toNetworkCookie(cookie);

  if (!normalizedCookie) {
    return null;
  }

  return {
    cookie: normalizedCookie,
    blockedReasons: (blockedReasons ?? []).filter((reason): reason is string => typeof reason === "string")
  };
}

function toNetworkCookie(cookie: CdpCookie | undefined): NetworkCookie | null {
  if (!cookie?.name) {
    return null;
  }

  return {
    name: cookie.name,
    value: cookie.value ?? "",
    ...(cookie.domain ? { domain: cookie.domain } : {}),
    ...(cookie.path ? { path: cookie.path } : {}),
    ...(typeof cookie.expires === "number" ? { expires: cookie.expires } : {}),
    ...(typeof cookie.size === "number" ? { size: cookie.size } : {}),
    ...(typeof cookie.httpOnly === "boolean" ? { httpOnly: cookie.httpOnly } : {}),
    ...(typeof cookie.secure === "boolean" ? { secure: cookie.secure } : {}),
    ...(typeof cookie.session === "boolean" ? { session: cookie.session } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    ...(cookie.priority ? { priority: cookie.priority } : {}),
    ...(typeof cookie.sameParty === "boolean" ? { sameParty: cookie.sameParty } : {}),
    ...(typeof cookie.sourcePort === "number" ? { sourcePort: cookie.sourcePort } : {}),
    ...(cookie.sourceScheme ? { sourceScheme: cookie.sourceScheme } : {}),
    ...(typeof cookie.partitionKey === "string" ? { partitionKey: cookie.partitionKey } : {}),
    ...(typeof cookie.partitioned === "boolean" ? { partitioned: cookie.partitioned } : {})
  };
}

async function getTabMediaStreamId(tabId: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId(
      {
        targetTabId: tabId
      },
      (streamId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!streamId) {
          reject(new Error("Chrome did not return a tab capture stream identifier."));
          return;
        }

        resolve(streamId);
      }
    );
  });
}

async function readDraft(): Promise<CaptureSessionDraft | null> {
  const stored = await chrome.storage.session.get(sessionStorageKey);
  const rawDraft = stored[sessionStorageKey];

  if (!rawDraft) {
    return null;
  }

  const parsed = captureSessionDraftSchema.safeParse(rawDraft);

  if (!parsed.success) {
    await clearDraft();
    return null;
  }

  return parsed.data;
}

async function saveDraft(draft: CaptureSessionDraft): Promise<void> {
  await chrome.storage.session.set({
    [sessionStorageKey]: draft
  });
}

async function clearDraft(): Promise<void> {
  await chrome.storage.session.remove(sessionStorageKey);
}

async function buildPopupResponse(ok: boolean, error?: string): Promise<PopupResponse> {
  return {
    ok,
    state: toPopupState(await readDraft()),
    error
  };
}

function toPopupState(activeSession: CaptureSessionDraft | null): PopupState {
  if (!activeSession) {
    return {
      activeSession: null,
      canStart: true,
      canStop: false
    };
  }

  const canStop = activeSession.phase === "armed" || activeSession.phase === "recording";

  return {
    activeSession: toPopupSessionSummary(activeSession),
    canStart: !canStop,
    canStop
  };
}

function toPopupSessionSummary(activeSession: CaptureSessionDraft): PopupSessionSummary {
  return {
    sessionId: activeSession.sessionId,
    name: activeSession.name,
    phase: activeSession.phase,
    createdAt: activeSession.createdAt,
    updatedAt: activeSession.updatedAt,
    page: activeSession.page,
    artifacts: activeSession.artifacts,
    eventCount: activeSession.events.length
  };
}

function isSessionBusy(draft: CaptureSessionDraft): boolean {
  return draft.phase === "armed" || draft.phase === "recording" || draft.phase === "processing";
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function stringifyConsoleArgs(args: CdpRemoteObject[] | undefined): string[] {
  return (args ?? []).map((arg) => stringifyRemoteObject(arg)).filter((value) => value.length > 0);
}

function stringifyRemoteObject(object: CdpRemoteObject): string {
  if (typeof object.unserializableValue === "string") {
    return object.unserializableValue;
  }

  if (typeof object.value === "string") {
    return object.value;
  }

  if (typeof object.value === "number" || typeof object.value === "boolean") {
    return String(object.value);
  }

  if (object.value !== undefined) {
    try {
      return JSON.stringify(object.value);
    } catch {
      return String(object.value);
    }
  }

  return object.description ?? object.className ?? object.type ?? "";
}

function sanitizeCapturedText(input: string): string {
  return input.replace(/https?:\/\/\S+/g, (candidate) => sanitizeCapturedUrl(candidate)).slice(0, 500);
}

function toConsoleLevel(type: string | undefined): "debug" | "info" | "warn" | "error" {
  switch (type) {
    case "debug":
    case "trace":
      return "debug";

    case "warning":
      return "warn";

    case "error":
    case "assert":
      return "error";

    default:
      return "info";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function queueDraftMutation<T>(operation: () => Promise<T>): Promise<T> {
  const nextOperation = draftMutationQueue.then(operation, operation);
  draftMutationQueue = nextOperation.then(
    () => undefined,
    () => undefined
  );
  return nextOperation;
}
