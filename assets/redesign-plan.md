# Desktop Redesign — Plan & Working Status

This document is the source of truth for the desktop UI redesign + backend org / share-link
integrations. If picked up later, scan **Status & next steps** first.

## Goals (from the original ask)

1. Desktop app becomes a real document/evidence asset manager — easy listing, search, quick access.
2. Clerk-based user management is properly integrated (sign in, profile, workspace switching).
3. Share links from the backend are usable directly from the desktop UI.
4. Org create + invite flows exist end-to-end (backend + desktop).
5. CSS / UI primitives (toasts, dialogs) layered in.

## Architectural decisions

- **No Tailwind.** The Bun bundler used by `apps/desktop/scripts/build.ts` doesn't run PostCSS.
  We keep a single hand-written design-token CSS sheet (`apps/desktop/src/mainview/index.css`).
  Components rely on small utility classes (`.row`, `.column`, `.muted`, `.chip`, etc.).
- **Token-based invitations.** We do not store user emails locally. Owners paste-share an `inv_…`
  token; recipients paste it into "Accept invite" inside their desktop. Avoids round-tripping to
  Clerk on signup.
- **Local sessions vs. cloud evidences are separate.** Library shows local-disk recordings, Cloud
  shows backend `/evidences`. A future enhancement is "promote local → cloud", out of scope here.
- **Sidebar shell** with sections: Library / Cloud / Organisations / Account / Settings.

## Backend (✅ shipped)

| File | Change |
| --- | --- |
| `apps/backend/src/db/tables/organization-invitations.ts` | New table (`status`, `role`, `tokenHash`, `expiresAt`, …) |
| `apps/backend/src/db/relations.ts` | Relations for invitations + new `users.sentInvitations` named relation |
| `apps/backend/src/db/schema.ts` | Re-exports |
| `apps/backend/drizzle/0005_organization_invitations.sql` | Migration |
| `apps/backend/drizzle/meta/_journal.json` | Journal entry idx=5 |
| `apps/backend/src/services/organization-management.ts` | `createOrganization`, `listOrganizationsForUser`, `listOrganizationMembers`, invitation create/list/revoke/accept, ownership/membership checks |
| `apps/backend/src/routes/orgs.ts` | Full rewrite — `GET /orgs`, `POST /orgs`, `POST /orgs/:orgId/select-active` (kept), `GET /orgs/:orgId/members`, `GET/POST /orgs/:orgId/invitations`, `POST /orgs/:orgId/invitations/:id/revoke`, `POST /orgs/invitations/accept` |
| `apps/backend/src/routes/share-links.ts` | New `GET /evidences/:id/share-links` so desktop can list active + revoked links |

`bun run --cwd apps/backend lint` and `typecheck` both pass; `bun test` shows 144/144 tests pass.

## Desktop (✅ shipped)

| File | Purpose |
| --- | --- |
| `apps/desktop/src/mainview/index.css` | New design system. Sidebar shell, status pills, segmented control, cards, tables, viewer overlay, toasts, dialogs. Includes `.viewer-left{flex:0 0 55%; min-width:0}` + `.viewer-right{min-width:0}` to satisfy `tests/desktop-viewer-layout.test.ts`. |
| `apps/desktop/src/mainview/utils.ts` | Adds `copyToClipboard`, `getInitials`, broader `formatRelativeTime`. |
| `apps/desktop/src/mainview/catalog-view.ts` | Adds search, sort options, `groupSessionsByDate`. Drops legacy HTML-string renderers (the React app never used them). |
| `apps/desktop/src/mainview/api.ts` | Typed `fetch` client for backend (`api.fetchAccountProfile`, evidences, share-links, orgs, members, invitations). |
| `apps/desktop/src/mainview/auth-context.tsx` | Extracted `DesktopClerkProvider` + `DesktopAuthProvider`. Exposes `getToken` + `refreshProfile`. |
| `apps/desktop/src/mainview/desktop-controller.ts` | Extracted `useDesktopController` from `app.tsx`. |
| `apps/desktop/src/mainview/ui/toast.tsx` | Toast provider + `useToast()` API (`success`, `error`, `info`, `warning`, `dismiss`). |
| `apps/desktop/src/mainview/ui/dialog.tsx` | `Dialog` and `ConfirmDialog` primitives. |
| `apps/desktop/src/mainview/pages/library-page.tsx` | Search, date-range, sort, group-by-date, confirm-on-delete dialog, toast feedback. |
| `apps/desktop/src/mainview/pages/cloud-page.tsx` | Lists `/evidences`. Per-row Share dialog with create/revoke/list share links + token reveal. |
| `apps/desktop/src/mainview/pages/organisation-page.tsx` | Create org, accept invite by token, manage members + invitations dialogs. |
| `apps/desktop/src/mainview/pages/account-page.tsx` | Profile summary, workspace switcher, sign-out. |
| `apps/desktop/src/mainview/pages/settings-page.tsx` | Output folder picker / save / open. |
| `apps/desktop/src/mainview/app.tsx` | New thin shell — sidebar + main header + route children + viewer overlay. Wraps everything in `<ToastProvider>`. |

`bun run --cwd apps/desktop typecheck` ✅, `bun run --cwd apps/desktop build` ✅.

## Status & next steps (resume from here)

- [x] Backend org/invite/share endpoints + migration.
- [x] CSS design system + toast/dialog primitives.
- [x] Library / Cloud / Organisations / Account / Settings pages.
- [x] Sidebar shell + auth wiring.
- [x] Whole-workspace `bun run typecheck` and `bun test` pass (144/144).
- [x] Desktop bundle builds.

Open follow-ups (not blocking):

1. Promote a local session to the cloud (one-click upload that creates an `Evidence` so it can be
   shared). Right now Library and Cloud are independent.
2. Surface the active workspace name in the main header and the sidebar account block already does
   this — consider a quick switcher in the header too.
3. Retry / pagination for `GET /evidences` once orgs grow large.
4. Email-driven invite acceptance (auto-link to a Clerk-signed-in user when emails match).

## Useful commands

```bash
# Backend
bun run --cwd apps/backend lint
bun run --cwd apps/backend typecheck
bun run --cwd apps/backend dev   # watch mode

# Desktop
bun run --cwd apps/desktop typecheck
bun run --cwd apps/desktop build  # builds dist/electron + dist/views/mainview
bun run --cwd apps/desktop dev    # runs electron after building

# Whole workspace
bun run typecheck
bun test
```

## Trace of important contract changes

- `GET /protected/me` already returned `organizations` with `isActive`. Desktop now reads
  `organizations.role` to gate the org-detail "Invite" UI to owners only.
- `POST /orgs` (new): non-personal org. Creator is added as `owner`. `users.activeOrgId` is updated
  to point to the new org.
- Invitations are token-based; owners reveal `token` *once* in the create response. Recipients call
  `POST /orgs/invitations/accept` with `{ token }`. Accept is transactional: insert membership,
  update invitation, set `users.activeOrgId` to the joined org.
- `GET /evidences/:id/share-links` (new): allows the desktop UI to list both active and historical
  links for an evidence.
