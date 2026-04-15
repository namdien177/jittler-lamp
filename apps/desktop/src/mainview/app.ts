import type { DesktopCompanionConfigSnapshot } from "../rpc";

const desktopBridge = electrobun as unknown as {
  rpc: {
    request: {
      chooseOutputDirectory(params: { startingFolder: string }): Promise<{ selectedPath: string | null }>;
      getCompanionConfig(params: undefined): Promise<DesktopCompanionConfigSnapshot>;
      openPath(params: { path: string }): Promise<{ ok: true }>;
      saveOutputDirectory(params: { outputDir: string }): Promise<DesktopCompanionConfigSnapshot>;
    };
  };
};

type FeedbackTone = "neutral" | "success" | "error";

type ViewState = {
  config: DesktopCompanionConfigSnapshot | null;
  draftOutputDir: string;
  feedback: {
    text: string;
    tone: FeedbackTone;
  };
  isChoosingFolder: boolean;
  isLoading: boolean;
  isSaving: boolean;
};

const state: ViewState = {
  config: null,
  draftOutputDir: "",
  feedback: {
    text: "Loading desktop companion settings…",
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
    <aside class="sidebar panel">
      <p class="eyebrow">Desktop companion</p>
      <h1 class="display-title">jittle-lamp</h1>
      <p class="body-copy muted">
        Local output routing for the companion writer. Changes stay on-device and apply to the running server immediately after save.
      </p>

      <section class="stack-sm">
        <div class="meta-row">
          <span class="meta-label">Resolution order</span>
          <span class="meta-value">env → saved file → default</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Current source</span>
          <span class="source-pill" data-role="source-pill">Loading…</span>
        </div>
        <div class="meta-row align-start">
          <span class="meta-label">Status</span>
          <span class="meta-copy muted" data-role="source-summary">Checking companion settings…</span>
        </div>
      </section>

      <section class="panel inset-panel stack-sm">
        <p class="section-label">Notes</p>
        <ul class="detail-list muted">
          <li>The desktop app writes to a local folder only.</li>
          <li>Environment overrides stay authoritative until removed.</li>
          <li>The companion server keeps artifact-write restrictions unchanged.</li>
        </ul>
      </section>
    </aside>

    <section class="content stack-lg">
      <header class="hero panel">
        <div class="hero-copy stack-sm">
          <p class="eyebrow">Output folder</p>
          <h2 class="section-title">Choose where the companion stores session artifacts.</h2>
          <p class="body-copy muted">
            This settings surface controls the folder used by the local desktop companion for future <code>recording.webm</code> and <code>session.events.json</code> writes.
          </p>
        </div>
        <div class="status-banner" data-role="feedback" data-tone="neutral">Loading desktop companion settings…</div>
      </header>

      <section class="settings-grid">
        <article class="panel stack-md">
          <div class="stack-xs">
            <p class="section-label">Effective destination</p>
            <div class="path-block" data-role="current-output-dir">—</div>
            <p class="helper-copy muted" data-role="effective-summary">Reading current companion output folder…</p>
          </div>

          <label class="stack-xs" for="output-dir-field">
            <span class="section-label">Saved folder</span>
            <input id="output-dir-field" class="path-input" type="text" readonly />
          </label>

          <div class="actions-row">
            <button class="button primary" type="button" data-role="choose-button">Choose folder…</button>
            <button class="button secondary" type="button" data-role="save-button">Save</button>
          </div>

          <div class="actions-row compact-row">
            <button class="button ghost" type="button" data-role="open-output-button">Open current folder</button>
            <button class="button ghost" type="button" data-role="open-config-button">Open config location</button>
          </div>
        </article>

        <article class="panel stack-md">
          <p class="section-label">Resolved details</p>

          <dl class="details-grid">
            <div class="detail-card">
              <dt>Source</dt>
              <dd data-role="detail-source">—</dd>
            </div>
            <div class="detail-card">
              <dt>Saved file</dt>
              <dd class="mono-text" data-role="detail-saved-output">—</dd>
            </div>
            <div class="detail-card detail-card-wide">
              <dt>Default folder</dt>
              <dd class="mono-text" data-role="detail-default-output">—</dd>
            </div>
            <div class="detail-card detail-card-wide">
              <dt>Config file</dt>
              <dd class="mono-text" data-role="detail-config-path">—</dd>
            </div>
          </dl>
        </article>
      </section>
    </section>
  </main>
`;

const sourcePill = queryElement<HTMLSpanElement>("[data-role='source-pill']");
const sourceSummary = queryElement<HTMLSpanElement>("[data-role='source-summary']");
const feedback = queryElement<HTMLDivElement>("[data-role='feedback']");
const currentOutputDir = queryElement<HTMLDivElement>("[data-role='current-output-dir']");
const effectiveSummary = queryElement<HTMLParagraphElement>("[data-role='effective-summary']");
const outputDirField = queryElement<HTMLInputElement>("#output-dir-field");
const chooseButton = queryElement<HTMLButtonElement>("[data-role='choose-button']");
const saveButton = queryElement<HTMLButtonElement>("[data-role='save-button']");
const openOutputButton = queryElement<HTMLButtonElement>("[data-role='open-output-button']");
const openConfigButton = queryElement<HTMLButtonElement>("[data-role='open-config-button']");
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
  void desktopBridge.rpc.request.openPath({
    path: state.config?.configFilePath ?? ""
  });
});

void loadInitialConfig();

function render(): void {
  const config = state.config;
  const draftOutputDir = config ? state.draftOutputDir : "";
  const isEnvOverrideActive = config?.envOverrideActive ?? false;
  const isDirty = Boolean(config && draftOutputDir !== config.outputDir);

  sourcePill.textContent = config ? formatSourceLabel(config.source) : "Loading…";
  sourcePill.dataset.source = config?.source ?? "pending";

  sourceSummary.textContent = config ? buildSourceSummary(config) : "Checking companion settings…";

  feedback.textContent = state.feedback.text;
  feedback.dataset.tone = state.feedback.tone;

  currentOutputDir.textContent = config?.outputDir ?? "—";
  effectiveSummary.textContent = config
    ? isEnvOverrideActive
      ? "Environment override is active, so the running companion is locked to this folder."
      : "Future companion writes will use this folder immediately after save."
    : "Reading current companion output folder…";

  outputDirField.value = draftOutputDir;
  outputDirField.disabled = true;

  detailSource.textContent = config ? formatSourceLabel(config.source) : "—";
  detailSavedOutput.textContent = config?.savedOutputDir ?? "No saved file override";
  detailDefaultOutput.textContent = config?.defaultOutputDir ?? "—";
  detailConfigPath.textContent = config?.configFilePath ?? "—";

  chooseButton.disabled = state.isLoading || state.isChoosingFolder || state.isSaving || isEnvOverrideActive;
  chooseButton.textContent = state.isChoosingFolder ? "Choosing…" : "Choose folder…";

  saveButton.disabled = state.isLoading || state.isSaving || !isDirty || isEnvOverrideActive;
  saveButton.textContent = state.isSaving ? "Saving…" : "Save";

  openOutputButton.disabled = state.isLoading || !config;
  openConfigButton.disabled = state.isLoading || !config;
}

async function loadInitialConfig(): Promise<void> {
  try {
    const config = await desktopBridge.rpc.request.getCompanionConfig(undefined);

    state.config = config;
    state.draftOutputDir = config.outputDir;
    state.feedback = {
      tone: "neutral",
      text: config.envOverrideActive
        ? "JITTLE_LAMP_OUTPUT_DIR is currently overriding the saved desktop setting."
        : "Choose a folder with the native picker, then save to update the companion immediately."
    };
  } catch (error) {
    state.feedback = {
      tone: "error",
      text: formatErrorMessage(error, "Unable to load desktop companion settings.")
    };
  } finally {
    state.isLoading = false;
    render();
  }
}

async function chooseFolder(): Promise<void> {
  if (!state.config || state.config.envOverrideActive) {
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
        text: "Folder selected. Save to switch the running companion to the new destination."
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
  if (!state.config || state.config.envOverrideActive) {
    return;
  }

  state.isSaving = true;
  state.feedback = {
    tone: "neutral",
    text: "Saving output folder and refreshing the running companion…"
  };
  render();

  try {
    const nextConfig = await desktopBridge.rpc.request.saveOutputDirectory({
      outputDir: state.draftOutputDir
    });

    state.config = nextConfig;
    state.draftOutputDir = nextConfig.outputDir;
    state.feedback = {
      tone: "success",
      text: "Saved. New companion writes will use this folder without restarting the server."
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
  if (!state.config) {
    return;
  }

  await desktopBridge.rpc.request.openPath({
    path: state.config.outputDir
  });
}

function buildSourceSummary(config: DesktopCompanionConfigSnapshot): string {
  switch (config.source) {
    case "env":
      return "Managed by JITTLE_LAMP_OUTPUT_DIR. Saved-file edits are disabled until that environment override is removed.";
    case "file":
      return "Loaded from the saved local config file and editable from this desktop panel.";
    case "default":
      return "Using the built-in default because no saved local override exists yet.";
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

render();
