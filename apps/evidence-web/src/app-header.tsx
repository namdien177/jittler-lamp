import React, { useCallback, useEffect, useRef, useState } from "react";
import { SignInButton, SignedIn, SignedOut, UserButton, useAuth } from "@clerk/clerk-react";
import { Link, useNavigate } from "react-router";

import { api, type ApiOrganization } from "./api";
import { clerkPublishableKey } from "./env";

export function AppHeader(): React.JSX.Element | null {
  if (!clerkPublishableKey) return null;
  return (
    <header className="app-header">
      <Link to="/" className="app-header-brand">
        Jittle Lamp
      </Link>
      <div className="app-header-right">
        <SignedIn>
          <OrganisationMenu />
          <UserButton />
        </SignedIn>
        <SignedOut>
          <SignInButton mode="modal">
            <button className="btn-ghost btn-sm" type="button">
              Sign in
            </button>
          </SignInButton>
        </SignedOut>
      </div>
    </header>
  );
}

function OrganisationMenu(): React.JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<ApiOrganization[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const getToken = useCallback(() => auth.getToken(), [auth]);

  const reload = useCallback(async (): Promise<void> => {
    if (!auth.isSignedIn) return;
    setLoading(true);
    setError(null);
    try {
      const profile = await api.fetchAccountProfile(getToken);
      setOrgs(profile.organizations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load organisations.");
    } finally {
      setLoading(false);
    }
  }, [auth.isSignedIn, getToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSwitch = async (orgId: string): Promise<void> => {
    setBusyOrgId(orgId);
    setError(null);
    try {
      await api.selectActiveOrganization(getToken, orgId);
      setOrgs((prev) => prev.map((org) => ({ ...org, isActive: org.id === orgId })));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to switch workspace.");
    } finally {
      setBusyOrgId(null);
    }
  };

  const goToJoin = (): void => {
    setOpen(false);
    navigate("/join");
  };

  const activeOrg = orgs.find((org) => org.isActive) ?? null;
  const triggerLabel = activeOrg?.name ?? (loading ? "Loading…" : "Select organisation");

  return (
    <div className="org-menu" ref={containerRef}>
      <button
        type="button"
        className="btn-ghost btn-sm org-menu-trigger"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void reload();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="org-menu-label">{triggerLabel}</span>
        <span className="org-menu-caret" aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="org-menu-popover" role="menu">
          <div className="org-menu-section-label">Your organisations</div>
          {loading && orgs.length === 0 ? (
            <div className="org-menu-empty">Loading…</div>
          ) : orgs.length === 0 ? (
            <div className="org-menu-empty">You're not in any organisation yet.</div>
          ) : (
            <ul className="org-menu-list">
              {orgs.map((org) => (
                <li key={org.id}>
                  <button
                    type="button"
                    className="org-menu-item"
                    data-active={org.isActive ? "true" : "false"}
                    disabled={busyOrgId !== null}
                    onClick={() => void handleSwitch(org.id)}
                  >
                    <span className="org-menu-item-name">{org.name}</span>
                    <span className="org-menu-item-meta">
                      {org.isPersonal ? "Personal" : org.role}
                      {org.isActive ? " · active" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error ? <div className="org-menu-error">{error}</div> : null}
          <div className="org-menu-divider" />
          <button type="button" className="org-menu-item org-menu-action" onClick={goToJoin}>
            Join organisation with code
          </button>
        </div>
      ) : null}
    </div>
  );
}
