import React from "react";

import type { DesktopUpdateState } from "../../rpc";
import type { DesktopController } from "../desktop-controller";
import { formatRuntimeLabel, formatSourceLabel } from "../catalog-view";
import { useToast } from "../ui/toast";

export function SettingsPage(props: { desktop: DesktopController }): React.JSX.Element {
  const { desktop } = props;
  const toast = useToast();
  const config = desktop.state.config;
  const update = desktop.state.update;
  const isEnvOverrideActive = config?.envOverrideActive ?? false;
  const isDirty = Boolean(config && desktop.state.draftOutputDir !== config.outputDir);
  const hasBridgeError = desktop.state.bridgeError !== null;
  const canInstallUpdate = update?.status === "downloaded";
  const isUpdateBusy =
    desktop.state.isCheckingForUpdate || update?.status === "checking" || update?.status === "downloading";

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Desktop settings</h1>
          <p className="page-subtitle">
            Where the companion saves new recordings and how it integrates with your local environment.
          </p>
        </div>
        <div>
          <span className="status-pill" data-status={desktop.state.runtime?.status ?? "starting"}>
            {formatRuntimeLabel(desktop.state.runtime?.status)}
          </span>
        </div>
      </div>

      {desktop.state.bridgeError ? (
        <div className="auth-error">{desktop.state.bridgeError}</div>
      ) : null}

      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Recording output folder</h2>
            <p className="card-subtitle">
              {config
                ? isEnvOverrideActive
                  ? "Environment override is active — the desktop route is locked until that variable is removed."
                  : "The extension will land new recordings into this folder while the companion is online."
                : "Reading current output folder…"}
            </p>
          </div>
        </div>
        <div className="card-section column" style={{ gap: 12 }}>
          {isEnvOverrideActive ? (
            <div className="banner-info" style={{ borderColor: "rgba(251, 191, 36, 0.3)", background: "var(--warning-soft)", color: "var(--warning)" }}>
              JITTLE_LAMP_OUTPUT_DIR is active and overrides the saved setting.
            </div>
          ) : null}
          <input
            className="input mono"
            type="text"
            value={desktop.state.draftOutputDir}
            onChange={(event) => desktop.setDraftOutputDir(event.currentTarget.value)}
            spellCheck={false}
          />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              className="button primary sm"
              type="button"
              disabled={hasBridgeError || desktop.state.isLoading || desktop.state.isChoosingFolder || desktop.state.isSaving || isEnvOverrideActive}
              onClick={desktop.chooseFolder}
            >
              {desktop.state.isChoosingFolder ? "Choosing…" : "Choose folder…"}
            </button>
            <button
              className="button secondary sm"
              type="button"
              disabled={hasBridgeError || desktop.state.isLoading || desktop.state.isSaving || !isDirty || isEnvOverrideActive}
              onClick={() => {
                desktop.saveFolder();
                toast.info("Saving output folder…");
              }}
            >
              {desktop.state.isSaving ? "Saving…" : "Save route"}
            </button>
            <button
              className="button ghost sm"
              type="button"
              disabled={hasBridgeError || desktop.state.isLoading || !config}
              onClick={desktop.openCurrentOutputFolder}
            >
              Open folder
            </button>
            <button
              className="button ghost sm"
              type="button"
              disabled={hasBridgeError || desktop.state.isLoading || !config}
              onClick={desktop.openConfigFile}
            >
              Open config
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">App updates</h2>
            <p className="card-subtitle">Check GitHub Releases for a newer packaged desktop build.</p>
          </div>
        </div>
        <div className="card-section column" style={{ gap: 12 }}>
          <div className="detail-grid">
            <Detail label="Current version" value={update?.currentVersion ?? "—"} />
            <Detail label="Latest found" value={update?.availableVersion ?? "—"} />
            <Detail label="Status" value={formatUpdateStatus(update)} />
            <Detail label="Last checked" value={formatUpdateDate(update?.lastCheckedAt)} />
          </div>
          {update?.status === "downloading" && update.progressPercent !== null ? (
            <div className="update-progress" aria-label="Update download progress">
              <span style={{ width: `${Math.max(0, Math.min(100, update.progressPercent))}%` }} />
            </div>
          ) : null}
          {update?.error ? <div className="auth-error">{update.error}</div> : null}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              className="button primary sm"
              type="button"
              disabled={hasBridgeError || isUpdateBusy || desktop.state.isInstallingUpdate}
              onClick={desktop.checkForUpdate}
            >
              {isUpdateBusy ? "Checking…" : "Check for update"}
            </button>
            <button
              className="button secondary sm"
              type="button"
              disabled={hasBridgeError || !canInstallUpdate || desktop.state.isInstallingUpdate}
              onClick={desktop.installUpdate}
            >
              {desktop.state.isInstallingUpdate ? "Opening installer…" : "Install update"}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Route details</h2>
            <p className="card-subtitle">Where the active configuration originates from.</p>
          </div>
        </div>
        <div className="card-section">
          <div className="detail-grid">
            <Detail label="Source" value={config ? formatSourceLabel(config.source) : "—"} />
            <Detail label="Saved file" value={config?.savedOutputDir ?? "No saved override"} />
            <Detail label="Default folder" value={config?.defaultOutputDir ?? "—"} />
            <Detail label="Config file" value={config?.configFilePath ?? "—"} />
            <Detail label="Runtime origin" value={desktop.state.runtime?.origin ?? "—"} />
            <Detail label="Runtime output dir" value={desktop.state.runtime?.outputDir ?? "—"} />
          </div>
          {desktop.state.runtime?.lastError ? (
            <div className="auth-error" style={{ marginTop: 12 }}>{desktop.state.runtime.lastError}</div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function Detail(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="detail-item">
      <span className="detail-label">{props.label}</span>
      <span className="detail-value">{props.value}</span>
    </div>
  );
}

function formatUpdateStatus(update: DesktopUpdateState | null | undefined): string {
  if (!update) return "—";

  if (update.status === "downloading" && update.progressPercent !== null) {
    return `Downloading ${Math.round(update.progressPercent)}%`;
  }

  return update.status
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatUpdateDate(value: string | null | undefined): string {
  if (!value) return "—";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
