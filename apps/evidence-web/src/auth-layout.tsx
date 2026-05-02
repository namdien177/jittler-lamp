import React from "react";
import { UserButton } from "@clerk/clerk-react";
import { NavLink } from "react-router";

import { useAccountProfile } from "./queries";

export function AuthSidebar(props: { evidenceCount?: number }): React.JSX.Element {
  const profileQuery = useAccountProfile();
  const profile = profileQuery.data ?? null;
  const activeOrg = profile?.organizations.find((org) => org.isActive) ?? null;
  const accountLabel = profile?.user.displayName ?? profile?.user.email ?? "Signed in";

  return (
    <aside className="auth-sidebar">
      <div className="auth-sidebar-brand">
        <img className="auth-sidebar-brand-mark" src="/logo.jpg" alt="" aria-hidden="true" />
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
          {props.evidenceCount !== undefined ? (
            <span className="auth-sidebar-link-count">{props.evidenceCount}</span>
          ) : null}
        </NavLink>
        <NavLink to="/quick-view" className={({ isActive }) => `auth-sidebar-link ${isActive ? "active" : ""}`}>
          <span className="auth-sidebar-link-icon" aria-hidden>
            ⇪
          </span>
          <span>Quick view ZIP</span>
        </NavLink>
        <NavLink to="/organisations" className={({ isActive }) => `auth-sidebar-link ${isActive ? "active" : ""}`}>
          <span className="auth-sidebar-link-icon" aria-hidden>
            ◫
          </span>
          <span>Organisations</span>
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
  );
}

export function AuthenticatedWebLayout(props: {
  children: React.ReactNode;
  evidenceCount?: number;
}): React.JSX.Element {
  return (
    <div className="auth-shell">
      <AuthSidebar {...(props.evidenceCount !== undefined ? { evidenceCount: props.evidenceCount } : {})} />
      {props.children}
    </div>
  );
}
