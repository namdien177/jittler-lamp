import type { ReactNode } from "react";
import clsx from "clsx";

import type { FeedbackTone } from "@jittle-lamp/viewer-core";
import type { NetworkSubtype, TimelineItem } from "@jittle-lamp/shared";

function getTimelineSubtitle(item: TimelineItem): string {
  return `${item.section} · ${new Date(item.at).toLocaleTimeString()}`;
}

function getNetworkDetails(item: TimelineItem): string {
  if (item.payload.kind !== "network") {
    return "";
  }

  const lines = [
    `URL: ${item.payload.url}`,
    `Method: ${item.payload.method}`,
    `Status: ${item.payload.status ?? "(pending)"}`,
    `Subtype: ${item.subtype ?? "other"}`
  ];

  return lines.join("\n");
}

export function Pane(props: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }): ReactNode {
  return (
    <section className={clsx("jl-pane", props.className)}>
      <header className="jl-pane-header">
        <h2>{props.title}</h2>
        {props.actions ? <div className="jl-pane-actions">{props.actions}</div> : null}
      </header>
      <div className="jl-pane-content">{props.children}</div>
    </section>
  );
}

export function ViewerShell(props: {
  phase: "idle" | "loading" | "error" | "viewing";
  error?: string | null;
  children: ReactNode;
  loadingFallback?: ReactNode;
  idleFallback?: ReactNode;
  onRetry?: () => void;
}): ReactNode {
  if (props.phase === "loading") {
    return <>{props.loadingFallback ?? <div role="status">Loading viewer…</div>}</>;
  }

  if (props.phase === "idle") {
    return <>{props.idleFallback ?? <div>Load a session archive to start.</div>}</>;
  }

  if (props.phase === "error") {
    return (
      <div role="alert" className="jl-viewer-error">
        <p>{props.error ?? "Unable to load viewer session."}</p>
        {props.onRetry ? (
          <button type="button" onClick={props.onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  return <>{props.children}</>;
}

export function TimelinePane(props: {
  items: TimelineItem[];
  activeIndex: number;
  selectedActionIds?: ReadonlySet<string>;
  autoFollow: boolean;
  onAutoFollowChange?: (value: boolean) => void;
  onItemSelect?: (args: { item: TimelineItem; index: number; event: "click" | "double-click" }) => void;
  renderItem?: (args: { item: TimelineItem; index: number; isActive: boolean; isSelected: boolean }) => ReactNode;
  emptyLabel?: ReactNode;
}): ReactNode {
  const selected = props.selectedActionIds ?? new Set<string>();

  return (
    <Pane
      title="Timeline"
      actions={
        <label>
          <input
            type="checkbox"
            checked={props.autoFollow}
            onChange={(event) => props.onAutoFollowChange?.(event.currentTarget.checked)}
          />
          Auto-follow
        </label>
      }
    >
      {props.items.length === 0 ? (
        <p>{props.emptyLabel ?? "No timeline entries."}</p>
      ) : (
        <ol className="jl-timeline-list">
          {props.items.map((item, index) => {
            const isActive = index === props.activeIndex;
            const isSelected = selected.has(item.id);

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={clsx("jl-timeline-item", isActive && "is-active", isSelected && "is-selected")}
                  onClick={() => props.onItemSelect?.({ item, index, event: "click" })}
                  onDoubleClick={() => props.onItemSelect?.({ item, index, event: "double-click" })}
                >
                  {props.renderItem?.({ item, index, isActive, isSelected }) ?? (
                    <>
                      <strong>{item.label}</strong>
                      <small>{getTimelineSubtitle(item)}</small>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Pane>
  );
}

export function NetworkPane(props: {
  items: TimelineItem[];
  activeIndex: number;
  detailIndex: number | null;
  searchQuery: string;
  subtypeFilter: NetworkSubtype | "all";
  onSearchChange?: (value: string) => void;
  onSubtypeFilterChange?: (value: NetworkSubtype | "all") => void;
  onDetailIndexChange?: (index: number | null) => void;
  onItemSelect?: (item: TimelineItem, index: number) => void;
  emptyLabel?: ReactNode;
}): ReactNode {
  return (
    <Pane
      title="Network"
      actions={
        <div className="jl-network-filters">
          <input
            type="search"
            value={props.searchQuery}
            onChange={(event) => props.onSearchChange?.(event.currentTarget.value)}
            placeholder="Search URL, headers, body"
          />
          <select
            value={props.subtypeFilter}
            onChange={(event) => props.onSubtypeFilterChange?.(event.currentTarget.value as NetworkSubtype | "all")}
          >
            <option value="all">All</option>
            <option value="xhr">XHR</option>
            <option value="fetch">Fetch</option>
            <option value="document">Document</option>
            <option value="stylesheet">Stylesheet</option>
            <option value="script">Script</option>
            <option value="image">Image</option>
            <option value="font">Font</option>
            <option value="media">Media</option>
            <option value="manifest">Manifest</option>
            <option value="beacon">Beacon</option>
            <option value="websocket">WebSocket</option>
            <option value="other">Other</option>
          </select>
        </div>
      }
    >
      {props.items.length === 0 ? (
        <p>{props.emptyLabel ?? "No network events matched this filter."}</p>
      ) : (
        <ul className="jl-network-list">
          {props.items.map((item, index) => {
            const isActive = index === props.activeIndex;
            const isOpen = index === props.detailIndex;

            return (
              <li key={item.id} className={clsx(isActive && "is-active")}> 
                <button
                  type="button"
                  onClick={() => {
                    props.onItemSelect?.(item, index);
                    props.onDetailIndexChange?.(isOpen ? null : index);
                  }}
                >
                  <strong>{item.label}</strong>
                  <small>{getTimelineSubtitle(item)}</small>
                </button>
                {isOpen ? <pre>{getNetworkDetails(item)}</pre> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Pane>
  );
}

export function MergeDialog(props: {
  open: boolean;
  selectedCount: number;
  value: string;
  error?: string | null;
  onValueChange?: (value: string) => void;
  onCancel?: () => void;
  onConfirm?: () => void;
  confirmLabel?: ReactNode;
}): ReactNode {
  if (!props.open) {
    return null;
  }

  return (
    <div role="dialog" aria-modal="true" className="jl-merge-dialog">
      <h3>Merge actions</h3>
      <p>{props.selectedCount} actions selected.</p>
      <label>
        Label
        <input type="text" value={props.value} onChange={(event) => props.onValueChange?.(event.currentTarget.value)} />
      </label>
      {props.error ? <p role="alert">{props.error}</p> : null}
      <footer>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" onClick={props.onConfirm}>
          {props.confirmLabel ?? "Merge"}
        </button>
      </footer>
    </div>
  );
}

export function FeedbackBanner(props: { tone: FeedbackTone; message: ReactNode; onDismiss?: () => void }): ReactNode {
  return (
    <aside className={clsx("jl-feedback-banner", `is-${props.tone}`)} role="status" aria-live="polite">
      <span>{props.message}</span>
      {props.onDismiss ? (
        <button type="button" aria-label="Dismiss" onClick={props.onDismiss}>
          ×
        </button>
      ) : null}
    </aside>
  );
}
