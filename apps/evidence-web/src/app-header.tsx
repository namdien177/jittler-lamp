import React, { useEffect, useRef, useState } from "react";
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Link, useNavigate } from "react-router";

import { clerkPublishableKey } from "./env";
import { useAccountProfile, useSelectActiveOrganization } from "./queries";

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
  const navigate = useNavigate();
  const profileQuery = useAccountProfile();
  const selectOrgMutation = useSelectActiveOrganization();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const orgs = profileQuery.data?.organizations ?? [];
  const loading = profileQuery.isFetching;
  const error =
    profileQuery.error instanceof Error
      ? profileQuery.error.message
      : selectOrgMutation.error instanceof Error
        ? selectOrgMutation.error.message
        : null;
  const busyOrgId = selectOrgMutation.isPending ? selectOrgMutation.variables ?? null : null;

  const handleSwitch = (orgId: string): void => {
    selectOrgMutation.mutate(orgId, {
      onSuccess: () => setOpen(false)
    });
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
        onClick={() => setOpen((prev) => !prev)}
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
                    onClick={() => handleSwitch(org.id)}
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
