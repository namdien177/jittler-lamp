import type React from "react";
import type { SessionArchive } from "@jittle-lamp/shared";

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
  const statusCode = payload.status ?? null;
  const isSuccess = statusCode !== null && statusCode >= 200 && statusCode < 300;
  const isError = statusCode !== null && statusCode >= 400;
  const statusClass = isSuccess ? "network-status-success" : isError ? "network-status-error" : "";
  const statusText = statusCode !== null ? `${statusCode}${payload.statusText ? ` ${payload.statusText}` : ""}` : "—";
  const durationText = payload.durationMs !== undefined ? `${payload.durationMs.toFixed(0)} ms` : "—";

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
        <div className="network-detail-section">
          <span className="network-detail-label">Request</span>
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
          <div className="network-detail-row">
            <span className="network-detail-key">Status</span>
            <button
              className={`network-copy-inline network-detail-val ${statusClass}`.trim()}
              type="button"
              onClick={() => void copy(statusText, "response status")}
            >
              {statusText}
            </button>
          </div>
          <div className="network-detail-row">
            <span className="network-detail-key">Duration</span>
            <button
              className="network-copy-inline network-detail-val"
              type="button"
              onClick={() => void copy(durationText, "request duration")}
            >
              {durationText}
            </button>
          </div>
          {payload.failureText ? (
            <div className="network-detail-row">
              <span className="network-detail-key">Failure</span>
              <button
                className="network-copy-inline network-detail-val network-status-error"
                type="button"
                onClick={() => void copy(payload.failureText ?? "", "failure message")}
              >
                {payload.failureText}
              </button>
            </div>
          ) : null}
        </div>
        <div className="network-detail-section">
          <span className="network-detail-label">Request headers</span>
          {payload.request.headers.length ? (
            payload.request.headers.map((header, headerIndex) => (
              <div className="network-header-row" key={`request-${header.name}-${headerIndex}`}>
                <button
                  className="network-copy-inline network-header-name"
                  type="button"
                  onClick={() => void copy(header.name, "header name")}
                >
                  {header.name}
                </button>
                <button
                  className="network-copy-inline network-header-value"
                  type="button"
                  onClick={() => void copy(header.value, "header value")}
                >
                  {header.value}
                </button>
              </div>
            ))
          ) : (
            <span className="network-body-empty">No headers</span>
          )}
        </div>
        <div className="network-detail-section">
          <span className="network-detail-label">Request body</span>
          <BodyCapture
            body={payload.request.body}
            emptyLabel="No request body"
            copy={copy}
          />
        </div>
        <div className="network-detail-section">
          <span className="network-detail-label">Response headers</span>
          {payload.response?.headers?.length ? (
            payload.response.headers.map((header, headerIndex) => (
              <div className="network-header-row" key={`response-${header.name}-${headerIndex}`}>
                <button
                  className="network-copy-inline network-header-name"
                  type="button"
                  onClick={() => void copy(header.name, "header name")}
                >
                  {header.name}
                </button>
                <button
                  className="network-copy-inline network-header-value"
                  type="button"
                  onClick={() => void copy(header.value, "header value")}
                >
                  {header.value}
                </button>
              </div>
            ))
          ) : (
            <span className="network-body-empty">No headers</span>
          )}
        </div>
        <div className="network-detail-section">
          <span className="network-detail-label">Response body</span>
          <BodyCapture
            body={payload.response?.body}
            emptyLabel="No response body"
            copy={copy}
          />
        </div>
      </div>
    </div>
  );
}

function BodyCapture(props: {
  body: SessionArchive["sections"]["network"][number]["payload"]["request"]["body"];
  emptyLabel: string;
  copy: (value: string, label: string) => Promise<void>;
}): React.JSX.Element {
  if (!props.body) {
    return <span className="network-body-empty">{props.emptyLabel}</span>;
  }

  if (props.body.disposition === "captured" && props.body.value !== undefined) {
    const previewText = props.body.encoding === "base64"
      ? `[base64, ${props.body.byteLength ?? "?"} bytes]`
      : props.body.value.slice(0, 2000);

    return (
      <button
        className="network-copy-block"
        type="button"
        onClick={() => void props.copy(props.body?.value ?? "", "request/response body")}
      >
        <pre className="network-body-pre">{previewText}</pre>
      </button>
    );
  }

  const reasonSuffix = props.body.reason ? ` (${props.body.reason})` : "";
  return (
    <span className="network-body-empty">{`${props.body.disposition}${reasonSuffix}`}</span>
  );
}
