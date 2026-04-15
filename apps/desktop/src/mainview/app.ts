import { Electroview } from "electrobun/view";

import type { DesktopCompanionConfigSnapshot, DesktopCompanionRuntimeSnapshot, DesktopRPC } from "../rpc";

type DesktopBridge = {
  rpc: {
    request: {
      chooseOutputDirectory(params: { startingFolder: string }): Promise<{ selectedPath: string | null }>;
      getCompanionConfig(params: undefined): Promise<DesktopCompanionConfigSnapshot>;
      getCompanionRuntime(params: undefined): Promise<DesktopCompanionRuntimeSnapshot>;
      openPath(params: { path: string }): Promise<{ ok: true }>;
      saveOutputDirectory(params: { outputDir: string }): Promise<DesktopCompanionConfigSnapshot>;
    };
  };
};

type FeedbackTone = "neutral" | "success" | "error";

type ViewState = {
  bridgeError: string | null;
  config: DesktopCompanionConfigSnapshot | null;
  runtime: DesktopCompanionRuntimeSnapshot | null;
  draftOutputDir: string;
  feedback: {
    text: string;
    tone: FeedbackTone;
  };
  isChoosingFolder: boolean;
  isLoading: boolean;
  isSaving: boolean;
};

const runtimePollIntervalMs = 2_000;
const desktopBridge = createDesktopBridge();

const state: ViewState = {
  bridgeError: null,
  config: null,
  runtime: null,
  draftOutputDir: "",
  feedback: {
    text: "Loading desktop companion status…",
    tone: "neutral"
  },
  isChoosingFolder: false,
  isLoading: true,
  isSaving: false
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Desktop main view root element was not found.");
}

const appRoot = app;

appRoot.innerHTML = `
  <main class="shell">
    <section class="masthead">
      <div class="masthead-copy">
        <p class="kicker">Desktop companion</p>
        <h1 class="brand">jittle-lamp</h1>
        <p class="lead">
          Local receiver for browser recordings. When the extension can see this process, it writes <code>recording.webm</code> and <code>session.events.json</code> straight into the selected folder.
        </p>
      </div>

      <div class="masthead-status">
        <span class="status-pill" data-role="runtime-pill" data-status="starting">Starting…</span>
        <p class="origin-line mono-text" data-role="origin-value">http://127.0.0.1:48115</p>
        <p class="subtle-copy" data-role="runtime-summary">Waiting for the local companion runtime.</p>
      </div>
    </section>

    <section class="dashboard">
      <article class="panel live-panel">
        <div class="panel-head">
          <div>
            <p class="section-kicker">Companion health</p>
            <h2 class="section-title">Live local bridge</h2>
          </div>
          <span class="source-pill" data-role="source-pill" data-source="pending">Loading…</span>
        </div>

        <div class="metrics">
          <div class="metric-block">
            <span class="metric-label">Server</span>
            <strong class="metric-value" data-role="metric-status">Starting…</strong>
          </div>
          <div class="metric-block">
            <span class="metric-label">Recent writes</span>
            <strong class="metric-value" data-role="metric-write-count">0</strong>
          </div>
          <div class="metric-block">
            <span class="metric-label">Active route</span>
            <strong class="metric-value metric-value-path" data-role="metric-output-dir">—</strong>
          </div>
        </div>

        <div class="feedback-banner" data-role="feedback" data-tone="neutral">Loading desktop companion status…</div>
        <div class="bridge-alert" data-role="bridge-alert" hidden></div>

        <div class="last-write" data-role="last-write">
          No artifacts received yet. The browser extension will fall back to downloads until the companion is reachable.
        </div>
      </article>

      <article class="panel route-panel">
        <div class="panel-head">
          <div>
            <p class="section-kicker">Storage route</p>
            <h2 class="section-title">Output folder</h2>
          </div>
        </div>

        <div class="path-card">
          <span class="metric-label">Effective destination</span>
          <div class="path-value" data-role="current-output-dir">—</div>
          <p class="subtle-copy" data-role="effective-summary">Reading the current output folder…</p>
        </div>

        <label class="field-label" for="output-dir-field">Saved folder</label>
        <input id="output-dir-field" class="path-input mono-text" type="text" readonly />

        <div class="action-row">
          <button class="button primary" type="button" data-role="choose-button">Choose folder…</button>
          <button class="button secondary" type="button" data-role="save-button">Save route</button>
        </div>

        <div class="action-row action-row-quiet">
          <button class="button ghost" type="button" data-role="open-output-button">Open folder</button>
          <button class="button ghost" type="button" data-role="open-config-button">Open config</button>
        </div>
      </article>

      <article class="panel activity-panel">
        <div class="panel-head">
          <div>
            <p class="section-kicker">Recent writes</p>
            <h2 class="section-title">Artifact feed</h2>
          </div>
        </div>

        <div class="activity-list" data-role="activity-list"></div>
      </article>

      <article class="panel detail-panel">
        <div class="panel-head">
          <div>
            <p class="section-kicker">Resolved settings</p>
            <h2 class="section-title">Route details</h2>
          </div>
        </div>

        <dl class="detail-grid">
          <div class="detail-item">
            <dt>Source</dt>
            <dd data-role="detail-source">—</dd>
          </div>
          <div class="detail-item">
            <dt>Saved file</dt>
            <dd class="mono-text" data-role="detail-saved-output">—</dd>
          </div>
          <div class="detail-item">
            <dt>Default folder</dt>
            <dd class="mono-text" data-role="detail-default-output">—</dd>
          </div>
          <div class="detail-item detail-item-wide">
            <dt>Config file</dt>
            <dd class="mono-text" data-role="detail-config-path">—</dd>
          </div>
        </dl>
      </article>
    </section>
  </main>
`;

const runtimePill = queryElement<HTMLSpanElement>("[data-role='runtime-pill']");
const originValue = queryElement<HTMLParagraphElement>("[data-role='origin-value']");
const runtimeSummary = queryElement<HTMLParagraphElement>("[data-role='runtime-summary']");
const sourcePill = queryElement<HTMLSpanElement>("[data-role='source-pill']");
const metricStatus = queryElement<HTMLElement>("[data-role='metric-status']");
const metricWriteCount = queryElement<HTMLElement>("[data-role='metric-write-count']");
const metricOutputDir = queryElement<HTMLElement>("[data-role='metric-output-dir']");
const feedback = queryElement<HTMLDivElement>("[data-role='feedback']");
const bridgeAlert = queryElement<HTMLDivElement>("[data-role='bridge-alert']");
const lastWrite = queryElement<HTMLDivElement>("[data-role='last-write']");
const currentOutputDir = queryElement<HTMLDivElement>("[data-role='current-output-dir']");
const effectiveSummary = queryElement<HTMLParagraphElement>("[data-role='effective-summary']");
const outputDirField = queryElement<HTMLInputElement>("#output-dir-field");
const chooseButton = queryElement<HTMLButtonElement>("[data-role='choose-button']");
const saveButton = queryElement<HTMLButtonElement>("[data-role='save-button']");
const openOutputButton = queryElement<HTMLButtonElement>("[data-role='open-output-button']");
const openConfigButton = queryElement<HTMLButtonElement>("[data-role='open-config-button']");
const activityList = queryElement<HTMLDivElement>("[data-role='activity-list']");
const detailSource = queryElement<HTMLElement>("[data-role='detail-source']");
const detailSavedOutput = queryElement<HTMLElement>("[data-role='detail-saved-output']");
const detailDefaultOutput = queryElement<HTMLElement>("[data-role='detail-default-output']");
const detailConfigPath = queryElement<HTMLElement>("[data-role='detail-config-path']");

chooseButton.addEventListener("click", () => {
  void chooseFolder();
});

saveButton.addEventListener("click", () => {
  void saveFolder();
});

openOutputButton.addEventListener("click", () => {
  void openCurrentOutputFolder();
});

openConfigButton.addEventListener("click", () => {
  if (!desktopBridge || !state.config) {
    return;
  }

  void desktopBridge.rpc.request.openPath({
    path: state.config.configFilePath
  });
});

void loadInitialData();

function render(): void {
  const config = state.config;
  const runtime = state.runtime;
  const hasBridgeError = state.bridgeError !== null;
  const isEnvOverrideActive = config?.envOverrideActive ?? false;
  const draftOutputDir = config ? state.draftOutputDir : "";
  const isDirty = Boolean(config && draftOutputDir !== config.outputDir);
  const latestWrite = runtime?.recentWrites[0];

  runtimePill.textContent = formatRuntimeLabel(runtime?.status);
  runtimePill.dataset.status = runtime?.status ?? "starting";

  originValue.textContent = runtime?.origin ?? "http://127.0.0.1:48115";
  runtimeSummary.textContent = buildRuntimeSummary(runtime);

  sourcePill.textContent = config ? formatSourceLabel(config.source) : "Loading…";
  sourcePill.dataset.source = config?.source ?? "pending";

  metricStatus.textContent = formatRuntimeMetric(runtime?.status);
  metricWriteCount.textContent = String(runtime?.recentWrites.length ?? 0);
  metricOutputDir.textContent = runtime?.outputDir ?? config?.outputDir ?? "—";

  feedback.textContent = state.feedback.text;
  feedback.dataset.tone = state.feedback.tone;

  bridgeAlert.hidden = !hasBridgeError;
  bridgeAlert.textContent = state.bridgeError ?? "";

  currentOutputDir.textContent = config?.outputDir ?? runtime?.outputDir ?? "—";
  effectiveSummary.textContent = config
    ? isEnvOverrideActive
      ? "Environment override is active, so the desktop route is locked until that variable is removed."
      : "The extension will use this folder whenever the local companion is online."
    : "Reading the current output folder…";

  outputDirField.value = draftOutputDir;
  outputDirField.disabled = true;

  detailSource.textContent = config ? formatSourceLabel(config.source) : "—";
  detailSavedOutput.textContent = config?.savedOutputDir ?? "No saved override";
  detailDefaultOutput.textContent = config?.defaultOutputDir ?? "—";
  detailConfigPath.textContent = config?.configFilePath ?? "—";

  chooseButton.disabled = hasBridgeError || state.isLoading || state.isChoosingFolder || state.isSaving || isEnvOverrideActive;
  chooseButton.textContent = state.isChoosingFolder ? "Choosing…" : "Choose folder…";

  saveButton.disabled = hasBridgeError || state.isLoading || state.isSaving || !isDirty || isEnvOverrideActive;
  saveButton.textContent = state.isSaving ? "Saving…" : "Save route";

  openOutputButton.disabled = hasBridgeError || state.isLoading || !config;
  openConfigButton.disabled = hasBridgeError || state.isLoading || !config;

  lastWrite.textContent = latestWrite
    ? `Last artifact: ${latestWrite.artifactName} from ${latestWrite.sessionId} at ${formatTimestamp(latestWrite.at)}.`
    : "No artifacts received yet. The browser extension will fall back to downloads until the companion is reachable.";

  renderActivityList(runtime);
}

async function loadInitialData(): Promise<void> {
  if (!desktopBridge) {
    state.bridgeError =
      "Electrobun view RPC did not initialize in this renderer.";
    state.feedback = {
      tone: "error",
      text: "Desktop runtime unavailable."
    };
    state.isLoading = false;
    render();
    return;
  }

  try {
    const [config, runtime] = await Promise.all([
      desktopBridge.rpc.request.getCompanionConfig(undefined),
      desktopBridge.rpc.request.getCompanionRuntime(undefined)
    ]);

    state.config = config;
    state.runtime = runtime;
    state.draftOutputDir = config.outputDir;
    state.feedback = {
      tone: runtime.status === "error" ? "error" : "neutral",
      text:
        runtime.status === "error"
          ? runtime.lastError ?? "The desktop companion failed to start."
          : config.envOverrideActive
            ? "JITTLE_LAMP_OUTPUT_DIR is currently overriding the saved desktop setting."
            : "Choose a folder, save it, and keep this app open while recording."
    };
  } catch (error) {
    state.feedback = {
      tone: "error",
      text: formatErrorMessage(error, "Unable to load desktop companion state.")
    };
  } finally {
    state.isLoading = false;
    render();
    startRuntimePolling();
  }
}

function startRuntimePolling(): void {
  if (!desktopBridge) {
    return;
  }

  setInterval(() => {
    void refreshRuntimeState();
  }, runtimePollIntervalMs);
}

async function refreshRuntimeState(): Promise<void> {
  if (!desktopBridge) {
    return;
  }

  try {
    const runtime = await desktopBridge.rpc.request.getCompanionRuntime(undefined);

    state.runtime = runtime;

    if (runtime.status === "error") {
      state.feedback = {
        tone: "error",
        text: runtime.lastError ?? "The desktop companion runtime is reporting an error."
      };
    } else if (state.feedback.tone !== "success" && !state.isSaving && !state.isChoosingFolder) {
      state.feedback = {
        tone: "neutral",
        text:
          runtime.status === "listening"
            ? "Desktop companion is listening locally. Extension exports should land here without browser download prompts."
            : "Waiting for the desktop companion runtime."
      };
    }

    render();
  } catch (error) {
    state.feedback = {
      tone: "error",
      text: formatErrorMessage(error, "Unable to refresh the companion runtime.")
    };
    render();
  }
}

async function chooseFolder(): Promise<void> {
  if (!desktopBridge || !state.config || state.config.envOverrideActive) {
    return;
  }

  state.isChoosingFolder = true;
  state.feedback = {
    tone: "neutral",
    text: "Waiting for a local folder selection…"
  };
  render();

  try {
    const { selectedPath } = await desktopBridge.rpc.request.chooseOutputDirectory({
      startingFolder: state.draftOutputDir || state.config.outputDir
    });

    if (selectedPath) {
      state.draftOutputDir = selectedPath;
      state.feedback = {
        tone: "neutral",
        text: "Folder selected. Save route to switch the running companion."
      };
    } else {
      state.feedback = {
        tone: "neutral",
        text: "Folder selection cancelled."
      };
    }
  } catch (error) {
    state.feedback = {
      tone: "error",
      text: formatErrorMessage(error, "Unable to open the native folder picker.")
    };
  } finally {
    state.isChoosingFolder = false;
    render();
  }
}

async function saveFolder(): Promise<void> {
  if (!desktopBridge || !state.config || state.config.envOverrideActive) {
    return;
  }

  state.isSaving = true;
  state.feedback = {
    tone: "neutral",
    text: "Saving folder route and refreshing the running companion…"
  };
  render();

  try {
    const nextConfig = await desktopBridge.rpc.request.saveOutputDirectory({
      outputDir: state.draftOutputDir
    });

    const nextRuntime = await desktopBridge.rpc.request.getCompanionRuntime(undefined);

    state.config = nextConfig;
    state.runtime = nextRuntime;
    state.draftOutputDir = nextConfig.outputDir;
    state.feedback = {
      tone: "success",
      text: "Saved. New extension exports will use this folder immediately."
    };
  } catch (error) {
    state.feedback = {
      tone: "error",
      text: formatErrorMessage(error, "Unable to save the output folder.")
    };
  } finally {
    state.isSaving = false;
    render();
  }
}

async function openCurrentOutputFolder(): Promise<void> {
  if (!desktopBridge || !state.config) {
    return;
  }

  await desktopBridge.rpc.request.openPath({
    path: state.config.outputDir
  });
}

function renderActivityList(runtime: DesktopCompanionRuntimeSnapshot | null): void {
  const recentWrites = runtime?.recentWrites ?? [];

  if (recentWrites.length === 0) {
    activityList.innerHTML = `
      <div class="empty-state">
        <p>No artifact writes yet.</p>
        <p class="subtle-copy">Start a browser recording and keep this app running to populate the live feed.</p>
      </div>
    `;
    return;
  }

  activityList.innerHTML = recentWrites
    .map(
      (write) => `
        <article class="activity-item">
          <div class="activity-topline">
            <strong>${escapeHtml(write.artifactName)}</strong>
            <span class="activity-time">${escapeHtml(formatRelativeTime(write.at))}</span>
          </div>
          <p class="activity-session mono-text">${escapeHtml(write.sessionId)}</p>
          <p class="activity-path mono-text">${escapeHtml(write.destinationPath)}</p>
          <p class="activity-meta">${escapeHtml(formatBytes(write.bytes))}</p>
        </article>
      `
    )
    .join("");
}

function buildRuntimeSummary(runtime: DesktopCompanionRuntimeSnapshot | null): string {
  if (!runtime) {
    return "Waiting for the local companion runtime.";
  }

  switch (runtime.status) {
    case "starting":
      return "Starting the localhost companion server.";
    case "listening":
      return runtime.recentWrites[0]
        ? `Listening and received ${runtime.recentWrites.length} recent artifact write${runtime.recentWrites.length === 1 ? "" : "s"}.`
        : "Listening on localhost and ready for extension exports.";
    case "error":
      return runtime.lastError ?? "The companion runtime reported an error.";
  }
}

function formatSourceLabel(source: DesktopCompanionConfigSnapshot["source"]): string {
  switch (source) {
    case "env":
      return "Environment override";
    case "file":
      return "Saved file";
    case "default":
      return "Default";
  }
}

function formatRuntimeLabel(status?: DesktopCompanionRuntimeSnapshot["status"]): string {
  switch (status) {
    case "listening":
      return "Online";
    case "error":
      return "Error";
    case "starting":
    default:
      return "Starting";
  }
}

function formatRuntimeMetric(status?: DesktopCompanionRuntimeSnapshot["status"]): string {
  switch (status) {
    case "listening":
      return "Listening";
    case "error":
      return "Blocked";
    case "starting":
    default:
      return "Booting";
  }
}

function formatTimestamp(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);

  if (Number.isNaN(parsed.getTime())) {
    return isoTimestamp;
  }

  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatRelativeTime(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);

  if (Number.isNaN(parsed.getTime())) {
    return isoTimestamp;
  }

  const deltaSeconds = Math.round((parsed.getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto"
  });

  if (Math.abs(deltaSeconds) < 60) {
    return formatter.format(deltaSeconds, "second");
  }

  const deltaMinutes = Math.round(deltaSeconds / 60);

  if (Math.abs(deltaMinutes) < 60) {
    return formatter.format(deltaMinutes, "minute");
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  return formatter.format(deltaHours, "hour");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function queryElement<T extends Element>(selector: string): T {
  const element = appRoot.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Desktop main view element not found for selector: ${selector}`);
  }

  return element;
}

function createDesktopBridge(): DesktopBridge | null {
  try {
    const rpc = Electroview.defineRPC<DesktopRPC>({
      maxRequestTime: 10_000,
      handlers: {
        requests: {},
        messages: {}
      }
    });

    new Electroview({ rpc });

    return {
      rpc: {
        request: rpc.request as DesktopBridge["rpc"]["request"]
      }
    };
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

render();
