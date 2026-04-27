import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClerkDegraded,
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  SignedIn,
  SignedOut,
  UserButton,
  useAuth
} from "@clerk/clerk-react";
import { Navigate, NavLink, useNavigate } from "react-router";

import { api, type ApiAccountProfile, type ApiEvidenceSummary } from "./api";

function formatRelativeTime(value: number | string): string {
  const ms = typeof value === "string" ? Date.parse(value) : value;
  if (!Number.isFinite(ms)) return "—";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return diff >= 0 ? "just now" : "in moments";
  if (abs < hour) {
    const mins = Math.round(abs / minute);
    return diff >= 0 ? `${mins}m ago` : `in ${mins}m`;
  }
  if (abs < day) {
    const hours = Math.round(abs / hour);
    return diff >= 0 ? `${hours}h ago` : `in ${hours}h`;
  }
  const days = Math.round(abs / day);
  return diff >= 0 ? `${days}d ago` : `in ${days}d`;
}

export function HomePage(): React.JSX.Element {
  return (
    <>
      <ClerkFailed>
        <Navigate to="/quick-view" replace />
      </ClerkFailed>
      <ClerkDegraded>
        <Navigate to="/quick-view" replace />
      </ClerkDegraded>
      <ClerkLoading>
        <main className="desktop-auth-page">
          <section className="desktop-auth-panel">
            <h1>Loading…</h1>
          </section>
        </main>
      </ClerkLoading>
      <ClerkLoaded>
        <SignedOut>
          <Navigate to="/quick-view" replace />
        </SignedOut>
        <SignedIn>
          <AuthenticatedHome />
        </SignedIn>
      </ClerkLoaded>
    </>
  );
}

function AuthenticatedHome(): React.JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ApiAccountProfile | null>(null);
  const [evidences, setEvidences] = useState<ApiEvidenceSummary[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getToken = useCallback(() => auth.getToken(), [auth]);

  const reload = useCallback(async (): Promise<void> => {
    if (!auth.isSignedIn) return;
    setLoading(true);
    setError(null);
    try {
      const [profileResult, evidenceResult] = await Promise.all([
        api.fetchAccountProfile(getToken),
        api.listEvidences(getToken)
      ]);
      setProfile(profileResult);
      setEvidences(evidenceResult.evidences);
      setOrgId(evidenceResult.orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load evidences.");
    } finally {
      setLoading(false);
    }
  }, [auth.isSignedIn, getToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return evidences;
    return evidences.filter((evidence) =>
      [evidence.title, evidence.sourceType, evidence.id].some((field) => field.toLowerCase().includes(query))
    );
  }, [evidences, search]);

  const activeOrg = profile?.organizations.find((org) => org.isActive) ?? null;
  const accountLabel =
    profile?.user.displayName ?? profile?.user.email ?? "Signed in";

  return (
    <div className="auth-shell">
      <aside className="auth-sidebar">
        <div className="auth-sidebar-brand">
          <div className="auth-sidebar-brand-mark">JL</div>
          <div className="column auth-sidebar-brand-text">
            <span className="auth-sidebar-brand-name">Jittle Lamp</span>
            <span className="auth-sidebar-brand-version">web evidence</span>
          </div>
        </div>

        <div className="auth-sidebar-section">
          <span className="auth-sidebar-section-label">Workspace</span>
          <NavLink to="/" end className={({ isActive }) => `auth-sidebar-link ${isActive ? "active" : ""}`}>
            <span className="auth-sidebar-link-icon" aria-hidden>
              ☁
            </span>
            <span>Cloud evidences</span>
            <span className="auth-sidebar-link-count">{evidences.length}</span>
          </NavLink>
          <NavLink to="/quick-view" className={({ isActive }) => `auth-sidebar-link ${isActive ? "active" : ""}`}>
            <span className="auth-sidebar-link-icon" aria-hidden>
              ⇪
            </span>
            <span>Quick view ZIP</span>
          </NavLink>
        </div>

        <div className="auth-sidebar-footer">
          <div className="auth-sidebar-account">
            <UserButton />
            <div className="auth-sidebar-account-meta">
              <span className="auth-sidebar-account-name">{accountLabel}</span>
              <span className="auth-sidebar-account-org">
                {activeOrg ? activeOrg.name : "No active workspace"}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <div className="auth-main">
        <header className="auth-main-header">
          <div>
            <h1 className="auth-page-title">Cloud evidences</h1>
            <p className="auth-page-subtitle">
              Evidence assets uploaded to your active workspace. Open any record to review the timeline, video, and
              network.
            </p>
          </div>
          <div className="auth-main-actions">
            <button
              type="button"
              className="auth-button ghost"
              onClick={() => void reload()}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <div className="auth-main-content">
          <div className="auth-toolbar">
            <input
              type="text"
              className="auth-search"
              placeholder="Search evidences by title, type, or id…"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            <div className="auth-toolbar-meta">
              {orgId ? (
                <span className="auth-muted auth-mono">workspace · {orgId.slice(0, 8)}</span>
              ) : null}
              <span className="auth-muted">
                {filtered.length} evidence{filtered.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {error ? <div className="auth-error-banner">{error}</div> : null}

          {filtered.length === 0 ? (
            <div className="auth-empty">
              <h3>{loading ? "Loading evidences…" : "No evidences in this workspace"}</h3>
              <p>
                Upload evidence from the desktop app or another tool to make it available here. Uploads land in your
                active organisation automatically.
              </p>
            </div>
          ) : (
            <div className="auth-evidence-grid">
              {filtered.map((evidence) => (
                <article key={evidence.id} className="auth-evidence-card">
                  <header className="auth-evidence-head">
                    <span className="auth-evidence-title">{evidence.title}</span>
                    <span className="auth-evidence-time" title={new Date(evidence.updatedAt).toISOString()}>
                      {formatRelativeTime(evidence.updatedAt)}
                    </span>
                  </header>
                  <div className="auth-evidence-meta">
                    <span className="auth-chip">{evidence.sourceType}</span>
                    <span className="auth-mono auth-soft">{evidence.id.slice(0, 12)}…</span>
                  </div>
                  <div className="auth-evidence-actions">
                    <button
                      type="button"
                      className="auth-button primary"
                      onClick={() => navigate(`/evidence/${encodeURIComponent(evidence.id)}`)}
                    >
                      View
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
