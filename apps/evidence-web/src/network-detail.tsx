import type React from "react";

import type { AppState, FeedbackTone } from "./react-app";

type NetworkDetailProps = {
  state: AppState;
  setFeedback: (text: string, tone: FeedbackTone) => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
};

export function NetworkDetail({ state, setFeedback, setState }: NetworkDetailProps): React.JSX.Element {
  const idx = state.networkDetailIndex;
  const item = idx === null ? null : state.timeline[idx];

  if (state.activeSection !== "network") {
    return (
      <div className="network-detail network-detail-empty" data-role="network-detail-empty">
        <div className="network-detail-header">
          <span className="network-detail-title">Network Request</span>
        </div>
        <div className="network-detail-body">
          <div className="network-detail-section">
            <span className="network-body-empty">
              Switch to the Network tab and select a request to inspect headers and bodies.
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!item || item.kind !== "network" || item.payload.kind !== "network") {
    return (
      <div className="network-detail network-detail-empty" data-role="network-detail-empty">
        <div className="network-detail-header">
          <span className="network-detail-title">Network Request</span>
        </div>
        <div className="network-detail-body">
          <div className="network-detail-section">
            <span className="network-detail-label">Ready to inspect</span>
          </div>
        </div>
      </div>
    );
  }

  const payload = item.payload;

  const copy = async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(`Copied ${label}.`, "success");
    } catch {
      setFeedback(`Failed to copy ${label}.`, "error");
    }
  };

  return (
    <div className="network-detail">
      <div className="network-detail-header">
        <span className="network-detail-title">Network Request</span>
        <button
          className="btn-ghost btn-sm"
          type="button"
          onClick={() => setState((prev) => ({ ...prev, networkDetailIndex: null }))}
        >
          ✕
        </button>
      </div>
      <div className="network-detail-body">
        <div className="network-detail-row">
          <span className="network-detail-key">Method</span>
          <button
            className="network-copy-inline network-detail-val"
            type="button"
            onClick={() => void copy(payload.method, "request method")}
          >
            {payload.method}
          </button>
        </div>
        <div className="network-detail-row">
          <span className="network-detail-key">URL</span>
          <button
            className="network-copy-inline network-detail-val network-url"
            type="button"
            onClick={() => void copy(payload.url, "request URL")}
          >
            {payload.url}
          </button>
        </div>
      </div>
    </div>
  );
}
