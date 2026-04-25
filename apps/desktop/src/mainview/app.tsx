import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { formatOffset, type TimelineSection } from "@jittle-lamp/shared";
import { deriveSectionTimeline } from "@jittle-lamp/viewer-core";
import { MemoryRouter, Navigate, NavLink, Outlet, useLocation, useNavigate, useRoutes } from "react-router";
import type { JittleRouteObject } from "@jittle-lamp/viewer-react";

import {
  DesktopAuthProvider,
  DesktopClerkProvider,
  clerkPublishableKey,
  useDesktopAuth
} from "./auth-context";
import { useDesktopController, type DesktopController } from "./desktop-controller";
import { LibraryPage } from "./pages/library-page";
import { CloudPage } from "./pages/cloud-page";
import { OrganisationPage } from "./pages/organisation-page";
import { AccountPage } from "./pages/account-page";
import { SettingsPage } from "./pages/settings-page";
import { ToastProvider } from "./ui/toast";
import { ViewerPane } from "./viewer-pane";
import { createDesktopNotesAdapter } from "./adapters";
import { getViewerSourceLabel } from "./viewer-source";
import { formatRuntimeLabel } from "./catalog-view";
import { getInitials } from "./utils";

const signInPath = "/sign-in";
const homePath = "/";

const DesktopControllerContext = React.createContext<DesktopController | null>(null);

function useDesktop(): DesktopController {
  const ctx = React.useContext(DesktopControllerContext);
  if (!ctx) throw new Error("Desktop controller is unavailable");
  return ctx;
}

function AuthStatusPage(props: { title: string; detail?: string }): React.JSX.Element {
  return (
    <main className="auth-page">
      <div className="auth-status" role="status">
        <span className="auth-status-title">{props.title}</span>
        {props.detail ? <span className="auth-status-detail">{props.detail}</span> : null}
      </div>
    </main>
  );
}

function MissingClerkConfigPage(): React.JSX.Element {
  return (
    <AuthStatusPage
      title="Clerk is not configured"
      detail="Set CLERK_PUBLISHABLE_KEY before starting the desktop app."
    />
  );
}

function SignInPage(): React.JSX.Element {
  const navigate = useNavigate();
  const auth = useDesktopAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (auth.state.status === "signed-in") {
    return <Navigate to={homePath} replace />;
  }

  const submitPasswordSignIn = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const result = await auth.signInWithPassword({ identifier: identifier.trim(), password });
    setIsSubmitting(false);
    if (result.ok) {
      navigate(homePath, { replace: true });
      return;
    }
    setError(result.message);
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-card-header">
          <h1>Welcome to Jittle Lamp</h1>
          <p>Sign in with your password or finish OAuth in your browser.</p>
        </div>
        <form className="auth-form" onSubmit={submitPasswordSignIn}>
          <label className="field">
            <span>Email or username</span>
            <input
              className="input field-input"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.currentTarget.value)}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              className="input field-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
            />
          </label>
          {error ? <div className="auth-error">{error}</div> : null}
          {auth.state.status === "error" ? <div className="auth-error">{auth.state.message}</div> : null}
          <button className="button primary lg" type="submit" disabled={isSubmitting || auth.state.status === "loading"}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="auth-divider" />
        <button
          className="button secondary lg"
          type="button"
          disabled={auth.browserFlow.status === "starting" || auth.browserFlow.status === "polling"}
          onClick={() => void auth.startBrowserSignIn()}
        >
          {auth.browserFlow.status === "starting" ? "Opening browser…" : "Continue in browser"}
        </button>
        {auth.browserFlow.status === "polling" ? (
          <div className="auth-browser-flow" role="status">
            <span>Waiting for browser sign-in</span>
            <strong>{auth.browserFlow.userCode}</strong>
            <a href={auth.browserFlow.verificationUriComplete} target="_blank" rel="noreferrer">
              Open sign-in page
            </a>
            <button className="button ghost xs" type="button" onClick={auth.clearBrowserFlow}>
              Cancel
            </button>
          </div>
        ) : null}
        {auth.browserFlow.status === "error" ? <div className="auth-error">{auth.browserFlow.message}</div> : null}
      </section>
    </main>
  );
}

function RequireAuth(props: { children: React.ReactNode }): React.JSX.Element {
  const auth = useDesktopAuth();

  if (auth.state.status === "loading") {
    return <AuthStatusPage title="Checking session…" />;
  }
  if (auth.state.status === "signed-in") {
    return <>{props.children}</>;
  }
  return <Navigate to={signInPath} replace />;
}

function Sidebar(): React.JSX.Element {
  const desktop = useDesktop();
  const auth = useDesktopAuth();
  const navigate = useNavigate();
  const profile = auth.state.status === "signed-in" ? auth.state.profile ?? null : null;
  const activeOrg = profile?.organizations.find((org) => org.isActive) ?? null;
  const accountLabel = auth.state.status === "signed-in" ? auth.state.label : "Signed out";
  const sessionCount = desktop.state.sessions.length;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (event: MouseEvent): void => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  const goto = (path: string): void => {
    setMenuOpen(false);
    navigate(path);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">JL</div>
        <div className="column" style={{ gap: 2 }}>
          <span className="sidebar-brand-name">Jittle Lamp</span>
          <span className="sidebar-brand-version">v0.1.6 · desktop</span>
        </div>
      </div>

      <div className="sidebar-section">
        <span className="sidebar-section-label">Workspace</span>
        <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <span className="sidebar-link-icon" aria-hidden>📚</span>
          <span>Library</span>
          <span className="sidebar-link-count">{sessionCount}</span>
        </NavLink>
        <NavLink to="/cloud" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <span className="sidebar-link-icon" aria-hidden>☁️</span>
          <span>Cloud evidences</span>
        </NavLink>
        <NavLink to="/organisations" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
          <span className="sidebar-link-icon" aria-hidden>👥</span>
          <span>Organisations</span>
        </NavLink>
      </div>

      <div className="sidebar-footer" ref={menuRef}>
        {menuOpen ? (
          <div className="sidebar-account-menu" role="menu">
            <button
              className="sidebar-account-menu-item"
              type="button"
              role="menuitem"
              onClick={() => goto("/account")}
            >
              <span aria-hidden>👤</span>
              <span>Account</span>
            </button>
            <button
              className="sidebar-account-menu-item"
              type="button"
              role="menuitem"
              onClick={() => goto("/account/companion")}
            >
              <span aria-hidden>⚙</span>
              <span>Companion settings</span>
            </button>
            {auth.state.status === "signed-in" ? (
              <>
                <div className="sidebar-account-menu-divider" />
                <button
                  className="sidebar-account-menu-item danger"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void auth.signOut();
                  }}
                >
                  <span aria-hidden>↩</span>
                  <span>Sign out</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="sidebar-account"
          aria-haspopup="menu"
          aria-expanded={menuOpen ? "true" : "false"}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <div className="sidebar-account-avatar">{getInitials(accountLabel)}</div>
          <div className="sidebar-account-meta">
            <span className="sidebar-account-name">{accountLabel}</span>
            <span className="sidebar-account-org">{activeOrg ? activeOrg.name : "No active workspace"}</span>
          </div>
          <span className="sidebar-account-chevron" aria-hidden>▾</span>
        </button>
      </div>
    </aside>
  );
}

function MainHeader(): React.JSX.Element {
  const desktop = useDesktop();
  const status = desktop.state.runtime?.status ?? "starting";
  return (
    <div className="main-header">
      <div className="main-header-title">
        <h1>Asset manager</h1>
        <span>{desktop.state.runtime?.outputDir ?? desktop.state.config?.outputDir ?? "—"}</span>
      </div>
      <div className="main-header-actions">
        <span className="status-pill" data-status={status}>{formatRuntimeLabel(status)}</span>
        <button className="button ghost sm" type="button" onClick={desktop.openLocalSession}>
          Open local
        </button>
        <button className="button ghost sm" type="button" onClick={desktop.importZip}>
          Import ZIP
        </button>
      </div>
    </div>
  );
}

function DesktopAppLayout(): React.JSX.Element {
  const desktop = useDesktopController();

  return (
    <DesktopControllerContext.Provider value={desktop}>
      <div className="app-shell">
        <Sidebar />
        <div className="main-area">
          <MainHeader />
          <div className="main-content">
            <Outlet />
          </div>
        </div>
      </div>
      <DesktopViewerOverlay />
    </DesktopControllerContext.Provider>
  );
}

function LibraryRoute(): React.JSX.Element {
  return <LibraryPage desktop={useDesktop()} />;
}

function SettingsRoute(): React.JSX.Element {
  return <SettingsPage desktop={useDesktop()} />;
}

function AccountLayout(): React.JSX.Element {
  const location = useLocation();
  const isCompanion = location.pathname === "/account/companion";

  return (
    <div className="page">
      <div className="account-tabs" aria-label="Account sections">
        <NavLink to="/account" end className={({ isActive }) => `account-tab ${isActive ? "active" : ""}`}>
          Account
        </NavLink>
        <NavLink
          to="/account/companion"
          className={({ isActive }) => `account-tab ${isActive || isCompanion ? "active" : ""}`}
        >
          Companion
        </NavLink>
      </div>
      <Outlet />
    </div>
  );
}

function DesktopViewerOverlay(): React.JSX.Element {
  const desktop = useDesktop();
  const payload = desktop.viewerState.payload;
  const notesAdapter = createDesktopNotesAdapter();
  const readOnlyNotice = payload ? notesAdapter.getReadOnlyNotice(payload.source) : null;
  const isReadOnly = payload ? !notesAdapter.canEdit(payload.source) : false;
  const detailItem =
    desktop.viewerState.networkDetailIndex === null
      ? null
      : desktop.viewerState.timeline[desktop.viewerState.networkDetailIndex] ?? null;
  const sectionItems = payload
    ? deriveSectionTimeline(
        payload.archive,
        desktop.viewerState.activeSection,
        desktop.viewerState.networkSubtypeFilter,
        desktop.viewerState.networkSearchQuery
      )
    : [];
  const activeItem = desktop.viewerState.activeIndex >= 0 ? sectionItems[desktop.viewerState.activeIndex] : null;
  const activeItemId = activeItem
    ? desktop.viewerState.activeSection === "actions"
      ? desktop.viewerState.mergeGroups.find((group) => group.memberIds.includes(activeItem.id))?.id ?? activeItem.id
      : activeItem.id
    : null;

  if (!desktop.viewerState.open || !payload) {
    return <div className="viewer-overlay" data-open="false" />;
  }

  return (
    <div
      className="viewer-overlay"
      data-open="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) desktop.closeViewer();
      }}
    >
      <div className="viewer-modal">
        <div className="viewer-header">
          <div className="viewer-header-left">
            <span className="viewer-title">{payload.archive.name}</span>
            <span className="viewer-source-badge" data-source={payload.source}>
              {getViewerSourceLabel(payload.source)}
            </span>
          </div>
          <button className="viewer-close" type="button" aria-label="Close viewer" onClick={desktop.closeViewer}>
            ✕
          </button>
        </div>
        <div className="viewer-body">
          <div className="viewer-left">
            <div className="viewer-video-wrap">
              <video
                className="viewer-video"
                ref={desktop.viewerVideoRef}
                controls
                onTimeUpdate={desktop.updateTimelineHighlight}
                onError={desktop.handleViewerVideoError}
              />
            </div>
            <div className="viewer-notes-section">
              <span className="viewer-notes-label">Session notes</span>
              {readOnlyNotice ? <div className="viewer-zip-notice">{readOnlyNotice}</div> : null}
              <textarea
                className="textarea viewer-notes-textarea"
                placeholder="Add notes…"
                value={desktop.viewerState.notesValue}
                readOnly={isReadOnly}
                onChange={(event) => desktop.setViewerNotesValue(event.currentTarget.value)}
              />
              {!isReadOnly ? (
                <div className="viewer-notes-actions">
                  <button
                    className="button primary sm"
                    type="button"
                    disabled={!desktop.viewerState.notesDirty || desktop.viewerState.notesSaving}
                    onClick={desktop.saveViewerNotes}
                  >
                    {desktop.viewerState.notesSaving ? "Saving…" : "Save notes"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="viewer-right" ref={desktop.viewerReactRootRef}>
            <ViewerPane
              activeSection={desktop.viewerState.activeSection}
              networkSearchQuery={desktop.viewerState.networkSearchQuery}
              networkSubtypeFilter={desktop.viewerState.networkSubtypeFilter}
              timelineRows={buildTimelineRows(desktop)}
              activeItemId={activeItemId}
              autoFollow={desktop.viewerState.autoFollow}
              focusVisible={!desktop.viewerState.autoFollow}
              networkDetail={detailItem}
              mergeDialog={{
                open: desktop.viewerState.mergeDialogOpen,
                value: desktop.viewerState.mergeDialogValue,
                error: desktop.viewerState.mergeDialogError
              }}
              onSectionChange={(section: TimelineSection) => desktop.setViewerSection(section)}
              onSubtypeChange={desktop.setViewerSubtype}
              onSearchChange={desktop.setViewerSearch}
              onTimelineClick={desktop.clickTimelineItem}
              onTimelineContext={desktop.openTimelineContext}
              onFocus={desktop.focusViewerTimeline}
              onCloseDetail={desktop.closeNetworkDetail}
              onCopy={(value, label) => void desktop.copyViewerValue(value, label)}
              onMergeValueChange={desktop.setMergeValue}
              onMergeConfirm={desktop.submitMergeDialog}
              onMergeCancel={desktop.closeMergeDialog}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

type TimelineRow = {
  id: string;
  offsetMs: number;
  section: TimelineSection;
  label: string;
  kind: string;
  selected: boolean;
  merged: boolean;
  mergedRange?: string;
  tags: string[];
};

function buildTimelineRows(desktop: DesktopController): TimelineRow[] {
  const viewerState = desktop.viewerState;
  const payload = viewerState.payload;
  if (!payload) return [];
  const section = viewerState.activeSection;
  const items = deriveSectionTimeline(payload.archive, section, viewerState.networkSubtypeFilter, viewerState.networkSearchQuery);

  if (section !== "actions") {
    return items.map((item) => ({
      id: item.id,
      offsetMs: item.offsetMs,
      section,
      label: item.label,
      kind: item.kind,
      selected: false,
      merged: false,
      tags: []
    }));
  }

  const mergedMemberIds = new Set(viewerState.mergeGroups.flatMap((group) => group.memberIds));
  const rows: TimelineRow[] = [];
  const seenGroupIds = new Set<string>();

  for (const item of items) {
    const group = viewerState.mergeGroups.find((candidate) => candidate.memberIds.includes(item.id));
    if (group) {
      if (seenGroupIds.has(group.id)) continue;
      seenGroupIds.add(group.id);
      const memberItems = items.filter((candidate) => group.memberIds.includes(candidate.id));
      const firstMs = Math.min(...memberItems.map((candidate) => candidate.offsetMs));
      const lastMs = Math.max(...memberItems.map((candidate) => candidate.offsetMs));
      rows.push({
        id: group.id,
        offsetMs: firstMs,
        section,
        label: group.label,
        kind: "action",
        selected: viewerState.selectedActionIds.has(group.id),
        merged: true,
        mergedRange: `${formatOffset(firstMs)}–${formatOffset(lastMs)}`,
        tags: group.tags
      });
      continue;
    }
    if (mergedMemberIds.has(item.id)) continue;
    rows.push({
      id: item.id,
      offsetMs: item.offsetMs,
      section,
      label: item.label,
      kind: item.kind,
      selected: viewerState.selectedActionIds.has(item.id),
      merged: false,
      tags: item.tags ?? []
    });
  }

  return rows;
}

const desktopRoutes: JittleRouteObject[] = [
  {
    path: `${signInPath}/*`,
    element: <SignInPage />
  },
  {
    path: "/",
    element: (
      <RequireAuth>
        <DesktopAppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <LibraryRoute /> },
      { path: "cloud", element: <CloudPage /> },
      { path: "organisations", element: <OrganisationPage /> },
      {
        path: "account",
        element: <AccountLayout />,
        children: [
          { index: true, element: <AccountPage /> },
          { path: "companion", element: <SettingsRoute /> }
        ]
      },
      { path: "settings", element: <Navigate to="/account/companion" replace /> },
      { path: "*", element: <Navigate to={homePath} replace /> }
    ]
  }
];

function DesktopRoutes(): React.JSX.Element {
  const element = useRoutes(desktopRoutes);
  return <>{element}</>;
}

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Desktop main view root element was not found.");

createRoot(root).render(
  <MemoryRouter>
    <ToastProvider>
      {clerkPublishableKey ? (
        <DesktopClerkProvider>
          <DesktopAuthProvider>
            <DesktopRoutes />
          </DesktopAuthProvider>
        </DesktopClerkProvider>
      ) : (
        <MissingClerkConfigPage />
      )}
      <Analytics />
    </ToastProvider>
  </MemoryRouter>
);
