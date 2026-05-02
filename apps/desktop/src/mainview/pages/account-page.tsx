import React from "react";

import { getAccountDisplayLabel, useDesktopAuth } from "../auth-context";
import { useAccountProfile } from "../queries";
import { getInitials } from "../utils";

export function AccountPage(): React.JSX.Element {
  const auth = useDesktopAuth();
  const profileQuery = useAccountProfile();

  if (auth.state.status !== "signed-in") {
    return (
      <>
        <div className="empty-state">
          <h3>Signed out</h3>
          <p>Sign in to view your account profile.</p>
        </div>
      </>
    );
  }

  const profile = profileQuery.data ?? null;
  const loading = profileQuery.isFetching;
  const error = profileQuery.error instanceof Error ? profileQuery.error.message : null;
  const displayLabel = profile ? getAccountDisplayLabel(profile, auth.state.label) : auth.state.label;
  const activeOrg = profile?.organizations.find((org) => org.isActive) ?? null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Account</h1>
          <p className="page-subtitle">Your signed-in identity and desktop session state.</p>
        </div>
        <div className="row">
          <button className="button ghost sm" type="button" onClick={() => void profileQuery.refetch()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button className="button danger sm" type="button" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>

      {error ? <div className="auth-error">{error}</div> : null}

      <section className="card">
        <div className="card-section">
          <div className="account-summary">
            <div className="account-avatar">{getInitials(displayLabel)}</div>
            <div className="column" style={{ gap: 4 }}>
              <span className="account-summary-name">{displayLabel}</span>
              <span className="account-summary-meta">
                {profile?.user.email && profile.user.email !== displayLabel
                  ? profile.user.email
                  : auth.state.source === "desktop"
                    ? "Browser session"
                    : "Clerk session"}
              </span>
            </div>
          </div>
        </div>
        <div className="card-section">
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Clerk user id</span>
              <span className="detail-value">{auth.state.userId}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Active workspace</span>
              <span className="detail-value">{activeOrg?.name ?? profile?.activeOrgId ?? "—"}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Session source</span>
              <span className="detail-value">{auth.state.source}</span>
            </div>
            {auth.state.expiresAt ? (
              <div className="detail-item">
                <span className="detail-label">Expires</span>
                <span className="detail-value">{new Date(auth.state.expiresAt).toLocaleString()}</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}
