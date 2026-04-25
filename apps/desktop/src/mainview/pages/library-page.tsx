import React, { useEffect, useMemo, useRef, useState } from "react";

import type { SessionRecord } from "../../rpc";
import { api, webOrigin, type ApiEvidenceSummary } from "../api";
import { useDesktopAuth } from "../auth-context";
import { filterSessions, groupSessionsByDate, type DatePreset, type SessionSortKey } from "../catalog-view";
import type { DesktopController } from "../desktop-controller";
import { ConfirmDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { formatBytes, formatRelativeTime } from "../utils";

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All" }
];

const SORT_OPTIONS: { value: SessionSortKey; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "size-desc", label: "Largest first" },
  { value: "size-asc", label: "Smallest first" },
  { value: "id-asc", label: "Session ID" }
];

export function LibraryPage(props: { desktop: DesktopController }): React.JSX.Element {
  const { desktop } = props;
  const toast = useToast();
  const auth = useDesktopAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SessionSortKey>("newest");
  const [grouped, setGrouped] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<SessionRecord | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [remoteEvidences, setRemoteEvidences] = useState<ApiEvidenceSummary[]>([]);

  useEffect(() => {
    if (auth.state.status !== "signed-in") return;
    let cancelled = false;
    void api.listEvidences(auth.getToken).then(
      (result) => {
        if (!cancelled) setRemoteEvidences(result.evidences);
      },
      () => {
        if (!cancelled) setRemoteEvidences([]);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [auth.state.status]);

  const sessions = useMemo(() => {
    const remoteBySessionId = new Map<string, ApiEvidenceSummary>();
    for (const evidence of remoteEvidences) {
      if (evidence.sourceType === "desktop-session" && evidence.sourceExternalId) {
        remoteBySessionId.set(evidence.sourceExternalId, evidence);
      }
    }

    const localIds = new Set(desktop.state.sessions.map((session) => session.sessionId));
    const localSessions = desktop.state.sessions.map((session) => {
      const remote = remoteBySessionId.get(session.sessionId);
      return remote
        ? {
            ...session,
            remoteEvidenceId: remote.id,
            remoteOrgId: remote.orgId,
            remoteSyncedAt: session.remoteSyncedAt ?? new Date(remote.updatedAt).toISOString()
          }
        : session;
    });

    const remoteOnly = remoteEvidences
      .filter(
        (evidence) =>
          evidence.sourceType === "desktop-session" &&
          evidence.sourceExternalId &&
          !localIds.has(evidence.sourceExternalId)
      )
      .map((evidence): SessionRecord => ({
        sessionId: evidence.sourceExternalId ?? evidence.id,
        sessionFolder: "Remote only",
        artifacts: [],
        totalBytes: 0,
        recordedAt: new Date(evidence.createdAt).toISOString(),
        tags: ["remote"],
        notes: "",
        remoteEvidenceId: evidence.id,
        remoteOrgId: evidence.orgId,
        remoteSyncedAt: new Date(evidence.updatedAt).toISOString()
      }));

    return [...localSessions, ...remoteOnly];
  }, [desktop.state.sessions, remoteEvidences]);

  const filtered = useMemo(
    () =>
      filterSessions({
        sessions,
        tagFilter: desktop.state.tagFilter,
        dateFilter: desktop.state.dateFilter,
        searchQuery,
        sort: sortKey
      }),
    [sessions, desktop.state.tagFilter, desktop.state.dateFilter, searchQuery, sortKey]
  );

  const handleRemoteSynced = (evidence: ApiEvidenceSummary): void => {
    setRemoteEvidences((previous) => [evidence, ...previous.filter((candidate) => candidate.id !== evidence.id)]);
  };

  const groups = useMemo(() => groupSessionsByDate(filtered), [filtered]);

  const handleDelete = (session: SessionRecord): void => setPendingDelete(session);

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setBusyDelete(true);
    try {
      await desktop.deleteSession(pendingDelete.sessionId);
      toast.success("Session deleted", `${pendingDelete.sessionId.slice(0, 12)}…`);
      setPendingDelete(null);
    } catch (error) {
      toast.error("Failed to delete session", error instanceof Error ? error.message : undefined);
    } finally {
      setBusyDelete(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-subtitle">
            Browse, search, and review every recording session captured by the companion. Local recordings stay on your
            machine.
          </p>
        </div>
        <div className="row">
          <button className="button secondary sm" type="button" onClick={desktop.openLocalSession}>
            Open local folder
          </button>
          <button className="button secondary sm" type="button" onClick={desktop.importZip}>
            Import ZIP
          </button>
        </div>
      </div>

      <div className="library-toolbar">
        <div className="search-input-wrap">
          <input
            type="text"
            className="input search-input"
            placeholder="Search sessions, tags, paths, or notes…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </div>

        <div className="row" style={{ gap: 6 }}>
          <div className="segmented" role="group" aria-label="Date filter">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-active={desktop.state.dateFilter === preset.id ? "true" : "false"}
                onClick={() => desktop.setDateFilter(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <select
            className="select"
            style={{ width: 160 }}
            value={sortKey}
            onChange={(event) => setSortKey(event.currentTarget.value as SessionSortKey)}
            aria-label="Sort sessions"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="row" style={{ gap: 6 }}>
          <button
            type="button"
            className="button ghost sm"
            onClick={() => setGrouped((prev) => !prev)}
            aria-pressed={grouped ? "true" : "false"}
          >
            {grouped ? "Flat list" : "Group by date"}
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            {filtered.length} of {sessions.length}
          </span>
        </div>
      </div>

      {desktop.state.tagFilter ? (
        <div className="row" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 11 }}>Filtered by tag:</span>
          <span className="chip accent">
            {desktop.state.tagFilter}
            <button className="chip-x" type="button" aria-label="Clear tag filter" onClick={() => desktop.setTagFilter(null)}>
              ✕
            </button>
          </span>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <h3>No sessions yet</h3>
          <p>Start a browser recording with the Jittle Lamp extension to see it appear here automatically.</p>
        </div>
      ) : grouped ? (
        groups.map((group) => (
          <section key={group.label} className="column" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {group.label}
              </h3>
              <span className="muted" style={{ fontSize: 11 }}>{group.sessions.length}</span>
            </div>
            <div className="session-grid">
              {group.sessions.map((session) => (
                <SessionCard
                  key={session.sessionId}
                  desktop={desktop}
                  session={session}
                  onRemoteSynced={handleRemoteSynced}
                  onDelete={() => handleDelete(session)}
                />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="session-grid">
          {filtered.map((session) => (
            <SessionCard
              key={session.sessionId}
              desktop={desktop}
              session={session}
              onRemoteSynced={handleRemoteSynced}
              onDelete={() => handleDelete(session)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this session?"
        description={
          pendingDelete
            ? `This permanently removes ${pendingDelete.sessionId} from the local library, including its archive and recording.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        busy={busyDelete}
        onConfirm={confirmDelete}
        onCancel={() => (busyDelete ? null : setPendingDelete(null))}
      />
    </div>
  );
}

function SessionCard(props: {
  desktop: DesktopController;
  session: SessionRecord;
  onRemoteSynced: (evidence: ApiEvidenceSummary) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const { desktop, session, onDelete, onRemoteSynced } = props;
  const auth = useDesktopAuth();
  const toast = useToast();
  const isEditingTag = desktop.state.editingTagSessionId === session.sessionId;
  const [tagDraft, setTagDraft] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const shareRef = useRef<HTMLDivElement | null>(null);

  const hasWebm = session.artifacts.some((a) => a.artifactName === "recording.webm");
  const hasJson = session.artifacts.some((a) => a.artifactName === "session.archive.json");
  const hasLocalRecord = hasWebm && hasJson;
  const hasRemoteRecord = Boolean(session.remoteEvidenceId);
  const syncStatus = hasLocalRecord && hasRemoteRecord ? "Synced" : hasRemoteRecord ? "Remote Only" : "Local Only";
  const syncStatusClass = hasLocalRecord && hasRemoteRecord ? "success" : hasRemoteRecord ? "warning" : "neutral";
  const hasVideo = hasWebm || hasRemoteRecord;
  const hasLogs = hasJson || hasRemoteRecord;
  const shortId =
    session.sessionId.length > 24 ? `${session.sessionId.slice(0, 10)}…${session.sessionId.slice(-8)}` : session.sessionId;

  const submitTag = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    desktop.addTagToSession(session.sessionId, trimmed);
    setTagDraft("");
  };

  useEffect(() => {
    if (!shareOpen) return;
    const onClickOutside = (event: MouseEvent): void => {
      if (!shareRef.current?.contains(event.target as Node)) setShareOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [shareOpen]);

  const syncToServer = async (): Promise<ApiEvidenceSummary | null> => {
    if (auth.state.status !== "signed-in") {
      toast.error("Sign in required", "Sign in before syncing to server.");
      return null;
    }
    if (!hasLocalRecord) {
      toast.error("Local record unavailable", "Remote-only records cannot be synced from this device yet.");
      return null;
    }
    if (session.remoteEvidenceId) {
      return {
        id: session.remoteEvidenceId,
        orgId: session.remoteOrgId ?? "",
        title: session.sessionId,
        sourceType: "desktop-session",
        sourceExternalId: session.sessionId,
        sourceMetadata: null,
        createdBy: "",
        createdAt: Date.parse(session.recordedAt),
        updatedAt: Date.now()
      };
    }

    setSyncing(true);
    try {
      const upload = await desktop.prepareSessionUpload(session.sessionId);
      const sourceMetadata = JSON.stringify({
        localSessionId: upload.sessionId,
        artifactFormat: "split",
        artifacts: upload.artifacts.map((artifact) => ({
          key: artifact.key,
          kind: artifact.kind,
          mimeType: artifact.mimeType,
          bytes: artifact.bytes,
          checksum: artifact.checksum
        }))
      });
      const started = await api.startDesktopSessionSync(auth.getToken, {
        sessionId: upload.sessionId,
        title: upload.title,
        sourceMetadata,
        artifacts: upload.artifacts.map((artifact) => ({
          key: artifact.key,
          kind: artifact.kind,
          mimeType: artifact.mimeType,
          bytes: artifact.bytes,
          checksum: artifact.checksum
        }))
      });
      for (const artifact of upload.artifacts) {
        const uploadSession = started.uploadSessions.find((candidate) => candidate.key === artifact.key);
        if (!uploadSession) throw new Error(`Missing upload session for ${artifact.key}`);
        await api.uploadEvidenceBlob(auth.getToken, uploadSession.uploadUrl, artifact.payload, artifact.mimeType);
        await api.completeEvidenceUpload(auth.getToken, uploadSession.uploadId, {
          bytes: artifact.bytes,
          checksum: artifact.checksum,
          mimeType: artifact.mimeType
        });
      }
      await desktop.markSessionRemoteSynced({
        sessionId: session.sessionId,
        evidenceId: started.evidenceId,
        orgId: started.organizationId
      });
      const evidence: ApiEvidenceSummary = {
        id: started.evidenceId,
        orgId: started.organizationId,
        title: upload.title,
        sourceType: "desktop-session",
        sourceExternalId: upload.sessionId,
        sourceMetadata,
        createdBy: "",
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      onRemoteSynced(evidence);
      toast.success("Synced to server", "Remote sharing is now available.");
      return evidence;
    } catch (error) {
      toast.error("Sync failed", error instanceof Error ? error.message : undefined);
      return null;
    } finally {
      setSyncing(false);
    }
  };

  const shareViaFile = async (): Promise<void> => {
    setShareOpen(false);
    try {
      await desktop.exportSessionZip(session.sessionId);
      toast.success("File exported", "Saved to the chosen folder.");
    } catch (error) {
      toast.error("Export failed", error instanceof Error ? error.message : undefined);
    }
  };

  const shareViaLink = async (): Promise<void> => {
    setShareOpen(false);
    if (auth.state.status !== "signed-in") {
      toast.error("Sign in required", "Sign in before creating a share link.");
      return;
    }
    setSharing(true);
    try {
      const evidence = session.remoteEvidenceId ? null : await syncToServer();
      const evidenceId = session.remoteEvidenceId ?? evidence?.id;
      if (!evidenceId) return;
      const result = await api.createShareLink(auth.getToken, evidenceId);
      const url = `${webOrigin}/share/${encodeURIComponent(result.shareLink.token)}`;
      await navigator.clipboard?.writeText(url);
      toast.success("Share link created", "Link copied to clipboard.");
    } catch (error) {
      toast.error("Share link failed", error instanceof Error ? error.message : undefined);
    } finally {
      setSharing(false);
    }
  };

  return (
    <article className="session-card">
      <div className="session-head">
        <span className="session-id" title={session.sessionId}>
          <span className="session-origin-icon" title={hasLocalRecord ? "Local recording available" : "Remote only"}>
            {hasLocalRecord ? "▣" : "☁"}
          </span>
          {shortId}
        </span>
        <span className="session-time" title={session.recordedAt}>{formatRelativeTime(session.recordedAt)}</span>
      </div>
      <div className="session-meta">
        <span className={`chip ${syncStatusClass}`}>{syncStatus}</span>
        {hasVideo ? <span className="chip neutral">Video</span> : null}
        {hasLogs ? <span className="chip neutral">Logs</span> : null}
        {hasLocalRecord ? <span className="chip neutral">{formatBytes(session.totalBytes)}</span> : null}
      </div>
      <div className="session-tags">
        {session.tags.map((tag) => (
          <span key={tag} className="chip accent">
            {tag}
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove tag ${tag}`}
              onClick={() => desktop.removeTagFromSession(session.sessionId, tag)}
            >
              ✕
            </button>
          </span>
        ))}
        {isEditingTag ? (
          <div className="tag-editor-wrap">
            <input
              type="text"
              className="tag-input-inline"
              autoFocus
              value={tagDraft}
              placeholder="tag name"
              onChange={(event) => setTagDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitTag(event.currentTarget.value);
                } else if (event.key === "Escape") {
                  desktop.cancelTagEdit();
                  setTagDraft("");
                }
              }}
              onBlur={() => {
                if (tagDraft.trim()) submitTag(tagDraft);
                else desktop.cancelTagEdit();
              }}
            />
          </div>
        ) : (
          <button className="tag-add-btn" type="button" onClick={() => desktop.startTagEdit(session.sessionId)}>
            + add tag
          </button>
        )}
      </div>
      <p className="session-path" title={session.sessionFolder}>{session.sessionFolder}</p>
      <div className="session-actions">
        <button className="button primary sm" type="button" disabled={!hasLocalRecord} onClick={() => desktop.viewSession(session.sessionId)}>
          Review
        </button>
        <button className="button ghost sm" type="button" onClick={() => desktop.openSessionFolder(session.sessionId)} disabled={!hasLocalRecord}>
          Open folder
        </button>
        {!hasRemoteRecord ? (
          <button className="button secondary sm" type="button" onClick={() => void syncToServer()} disabled={!hasLocalRecord || syncing}>
            {syncing ? "Syncing…" : "Sync"}
          </button>
        ) : null}
        <div className="share-menu-wrap" ref={shareRef}>
          <button
            className="button ghost sm"
            type="button"
            disabled={(!hasLocalRecord && !hasRemoteRecord) || syncing || sharing}
            onClick={() => setShareOpen((prev) => !prev)}
          >
            Share ▾
          </button>
          {shareOpen ? (
            <div className="share-menu" role="menu">
              <button className="share-menu-item" type="button" role="menuitem" disabled={!hasRemoteRecord && !hasLocalRecord} onClick={() => void shareViaLink()}>
                Via Link
              </button>
              <button className="share-menu-item" type="button" role="menuitem" disabled={!hasLocalRecord} onClick={() => void shareViaFile()}>
                Via File
              </button>
            </div>
          ) : null}
        </div>
        <button
          className="button ghost sm icon-only"
          type="button"
          aria-label="Delete session"
          title="Delete"
          disabled={!hasLocalRecord}
          onClick={onDelete}
        >
          ✕
        </button>
      </div>
    </article>
  );
}
