# Viewer Modal Rework — Plan & Working Status

This document is the source of truth for the desktop + webapp viewer modal rework.
It is structured so that work can be paused after any **CHECKPOINT** and resumed without
loss of context. Read **Status & next steps** first when picking this up later.

## Original ask (verbatim)

> rework the viewer-modal component on desktop and webapp. the UI should maintain 2 sections
> in parallel but more responsive:
> - open dialog with width/height = 90% container width/height.
> - Show title/tags of the session as the modal header. add button to copy the link
>   (if has share link mode), or if owner, can have option to create share link + download
>   as zip, or if not owner can download zip only
> - on width > height: video + note on left column, trackings/logs on right column.
>   left/right ratio is minimal 3/4, with max width of right container is 600px.
> - video/note height should always maintain minimal 2/1 ratio with video always display
>   in 4:3 ratio
> - trackings/logs should keeps tabs separation as right now, and specific functionalities
>   for each category too: Actions, Logs, Networks. They are all have scrollable area
>   (multiple records) and that scrollable area also need to be dynamically heigh adjusted
>   (e.g when clicking on a request, it will shows all the information of that request in
>   a drawer panel show up from the below, with max height is 70% of the height of the
>   section (this drawal should also vertical scrollable).
> - remember we do have search within the evidence for all tab now (previously was only
>   for network tab)
> - ensure filters and categories (ALL, XHR/Fetch, HTML, CSS, JS, WS, ....) work.
> - Support new "right-click" action on each record of request -> show sub menu that has:
>   "Copy CURL", "Copy response"
> - ensure responsed data from request is shown correctly (just raw string is fine).

## Architectural decisions

These decisions resolve all the open questions raised before kickoff. They were made
unilaterally so the work can ship without further clarification rounds. If something
turns out wrong, mark it in **Status & next steps** and revisit.

1. **Both targets become a real modal-overlay.**
   - Desktop already renders the viewer as a full-screen overlay above the routes; we keep that.
   - Webapp today renders the viewer as a full-page route (`/` and `/share/:token`).
     We keep the routes, but replace the page body with the same shared modal component
     mounted as a fixed overlay. The page underneath becomes a thin shell (drop zone for `/`,
     a tiny "Loading shared evidence" panel for `/share/:token`). When the viewer is open
     it covers everything, exactly like desktop. This keeps URL semantics (deep links to
     a share token still work) but unifies the look and behavior.

2. **Single shared component lives in `packages/viewer-react`.**
   - New component: `<ViewerModal>` (composed of `<ViewerModalHeader>`, `<ViewerVideoNotesPane>`,
     `<ViewerEvidencePane>`, `<NetworkRequestDrawer>`).
   - The component is presentational: it receives state + callbacks. Each app keeps its own
     state container (desktop's `useDesktopController`, webapp's local `useState` reducer).
     This avoids merging the two state machines, which are intentionally different (Electron
     bridge vs. browser fetch).
   - Tests for the component live next to it via `bun:test` + `react-test-renderer`-free DOM
     assertions where practical, otherwise headless behavior tests via the existing test
     fixtures pattern.

3. **CSS is shipped as a side-effect import from the shared package.**
   - `packages/viewer-react/src/viewer-modal.css` is bundled and imported by each app's
     entry. Both apps' `index.css` are updated to:
     a) import the shared file (or, since the desktop bundler does not run a CSS importer,
        we *paste-include* the shared CSS through a build-time concatenation script — see CP1
        for the exact strategy).
     b) drop the now-duplicated rules.
   - **Strategy chosen:** keep the shared CSS as a string export (`viewerModalStyles`) and
     have each app inject it via a `<style>` tag at module load. This avoids touching
     either bundler. Risk: order-of-cascade. We mitigate by namespacing every selector
     under `.jl-viewer-modal` and exposing a small set of CSS variables for theming.

4. **Owner detection.**
   - Desktop: a session opened from the local Library is "owner-equivalent" (the user owns
     the local files). A session opened from the Cloud page comes through a viewer source
     that already encodes whether the current user can manage it; we pass `isOwner: true`
     for local + cloud-owned, `isOwner: false` otherwise.
   - Webapp `/share/:token`: the resolve API does **not** today return ownership. We extend
     the resolve response with `isOwner: boolean` (backend change). Webapp `/` (drop a zip)
     is treated as `isOwner: true` because the user has the bytes locally.
   - **If we decide we don't want to extend the backend right now**, fallback: treat all
     share-link viewers as non-owner (just hide the create-share-link button on web). The
     "create share link" path is desktop-only today anyway, so this is a safe deferral.
     **Default chosen for v1:** defer the backend change; web share viewers are non-owner.

5. **Download-zip availability.**
   - Desktop: always available (uses `bridge.exportSessionZip`).
   - Web `/`: available (uses `buildReviewedZipBlob`).
   - Web `/share/:token`: available; we already have the archive bytes loaded in memory.
     We synthesize a zip via the existing `buildReviewedZipBlob` path. (Recording bytes
     are not currently held in state for shares — we will fetch them lazily on click.)

6. **Tags in the header.**
   - Desktop: pass `payload.archive.session.tags` if available. Today desktop has session-level
     tags via `SessionRecord.tags` (`addSessionTag`/`removeSessionTag`). The viewer payload
     does not include them — we plumb `tags: string[]` through `ViewerPayload`.
   - Webapp: tags are not available on share resolve today; render an empty tag list. Adding
     tags to the resolve payload is a follow-up. For zip-drop on `/`, no tags either.
   - **Tags are read-only in the modal header.** Editing tags stays on the Library page.

7. **Right-click "Copy CURL / Copy response".**
   - Implemented purely client-side. cURL synth uses method, URL, headers, request body.
     Copy response uses the captured response body raw string (truncated at the same 2000
     char preview boundary in display, but the **copy** uses the full captured string).
   - Coexists with left-click. Left-click toggles the bottom drawer; right-click shows the
     custom context menu (suppresses the native one). Outside-click and Escape close the menu.

8. **Logs tab.**
   - Same scrollable list + search behavior as Actions.
   - Click on a log row: open the same bottom drawer with a "Console entry" view (raw level,
     args, stack if present). No right-click menu on logs in v1.

9. **Search across all tabs.**
   - Replace per-section searches with a single `<input>` in the right pane header. The
     query filters whichever tab is active. Today the filter only works on network — we
     extend `buildSectionTimeline` to take a query for actions and console too. (Already
     supported by the helper; we just thread the value through.)

10. **Dimensions.**
    - Modal: `width: min(90vw, 1600px); height: 90vh;` (90% of viewport on each axis).
    - Left/right ratio: `grid-template-columns: minmax(0, 3fr) minmax(0, min(4fr, 600px));`
      gives the 3/4 minimum with the right pane capped at 600px.
    - Vertical (left column): video gets `flex: 2 1 auto;` notes get `flex: 1 1 auto;` so
      video : notes ≥ 2 : 1. Video container has `aspect-ratio: 4/3` and `max-height: 100%`.
    - Drawer: `max-height: 70%` of the right pane; `overflow-y: auto`. Toggleable.

11. **Existing test `tests/desktop-viewer-layout.test.ts` is updated**, not deleted.
    It currently asserts `.viewer-left { flex: 0 0 55% }`. The new layout is grid-based
    with `minmax(0, 3fr)`. We replace the assertion to validate the new contract:
    "left pane shrinks safely; right pane caps at 600px". The intent (long content
    cannot blow out the layout) is preserved.

12. **Out of scope (explicit deferrals).**
    - Promote local → cloud (already deferred elsewhere).
    - Backend `isOwner` on share resolve.
    - Backend tags in share resolve.
    - Editing tags from inside the viewer.
    - Drawer for non-network items beyond Console (logs use a simple read-only view; v1).
    - Mobile / portrait-orientation viewer (we only handle landscape; portrait collapses
      to a stacked column with a single-pane swap, but is not pixel-polished in v1).

## Component contract (CP1 deliverable)

```tsx
type ViewerModalProps = {
  open: boolean;
  onClose: () => void;

  // header
  title: string;
  tags: string[];
  source: "local" | "zip" | "cloud" | "share";
  isOwner: boolean;
  shareLinkUrl: string | null;       // present iff a share link already exists
  onCopyShareLink?: () => void;       // shown when shareLinkUrl is non-null
  onCreateShareLink?: () => void;     // shown when isOwner && !shareLinkUrl
  onDownloadZip?: () => void;         // always shown when defined

  // video + notes (left)
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoSrc?: string;                  // webapp passes a string; desktop wires its own loader
  notesValue: string;
  notesReadOnly: boolean;
  notesSaving: boolean;
  notesDirty: boolean;
  notesNotice?: string | null;
  onNotesChange: (v: string) => void;
  onSaveNotes: () => void;
  onVideoTimeUpdate: () => void;
  onVideoError?: () => void;

  // evidence pane (right)
  activeSection: TimelineSection;     // "actions" | "console" | "network"
  onSectionChange: (s: TimelineSection) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  subtypeFilter: NetworkSubtype | "all";
  onSubtypeFilterChange: (v: NetworkSubtype | "all") => void;
  rows: TimelineRow[];
  activeItemId: string | null;
  selectedActionIds: ReadonlySet<string>;
  autoFollow: boolean;
  onItemClick: (row: TimelineRow, e: React.MouseEvent) => void;
  onItemContextMenu: (row: TimelineRow, e: React.MouseEvent) => void;
  onAutoFollowToggle: () => void;

  // drawer
  drawerItem: TimelineItem | null;    // open when non-null
  onDrawerClose: () => void;
  onCopy: (value: string, label: string) => void;

  // network request right-click menu
  contextMenu: { open: boolean; x: number; y: number; rowId: string | null };
  onContextMenuClose: () => void;
  onCopyCurl: (rowId: string) => void;
  onCopyResponse: (rowId: string) => void;

  // merge dialog (re-uses existing component)
  mergeDialog: { open: boolean; value: string; error: string | null };
  onMergeValueChange: (v: string) => void;
  onMergeConfirm: () => void;
  onMergeCancel: () => void;

  feedback?: { tone: "neutral" | "success" | "error"; text: string } | null;
  feedbackOnDismiss?: () => void;
};
```

The component is **dumb** about state, persistence, and IO. Each app provides callbacks
that wire to its existing controllers.

## Files touched

**New (CP1):**
- `packages/viewer-react/src/viewer-modal/index.tsx` — main component.
- `packages/viewer-react/src/viewer-modal/header.tsx`
- `packages/viewer-react/src/viewer-modal/video-notes-pane.tsx`
- `packages/viewer-react/src/viewer-modal/evidence-pane.tsx`
- `packages/viewer-react/src/viewer-modal/network-drawer.tsx`
- `packages/viewer-react/src/viewer-modal/context-menu.tsx`
- `packages/viewer-react/src/viewer-modal/curl.ts` — pure helper, fully unit-tested.
- `packages/viewer-react/src/viewer-modal/styles.ts` — exports `viewerModalStyles: string`.
- `packages/viewer-react/src/index.ts` — re-exports.
- `tests/viewer-modal.test.ts` — DOM-free unit tests for the curl synthesizer + the
  helper that derives drawer state from a click event.

**Modified (CP4 desktop):**
- `apps/desktop/src/mainview/app.tsx` — replace `DesktopViewerOverlay`'s body with
  `<ViewerModal>`. Remove the local `viewer-modal` div + `viewer-pane.tsx` markup.
- `apps/desktop/src/mainview/desktop-controller.ts` — add `isOwner`, `shareLinkUrl`,
  `tags`, drawer item, context menu state; thread the new callbacks (`onCopyCurl`,
  `onCopyResponse`, `onCreateShareLink`, `onCopyShareLink`, `onDownloadZip`).
- `apps/desktop/src/mainview/index.css` — drop the legacy `.viewer-modal/.viewer-left/...`
  rules; inject the shared stylesheet via the new entry hook.
- `tests/desktop-viewer-layout.test.ts` — update assertions for the new grid contract.

**Modified (CP5 webapp):**
- `apps/evidence-web/src/react-app.tsx` — extract page-level state into a tiny
  `useViewerState` hook; render `<ViewerModal>` overlaying the route shell.
- `apps/evidence-web/src/network-detail.tsx` — delete (replaced by drawer in shared component).
- `apps/evidence-web/src/index.css` — drop duplicated viewer rules; rely on shared styles.

**Possibly modified (deferred, see decision #4):**
- `apps/backend/src/routes/share-links.ts` — add `isOwner` to resolve response.
- `apps/backend/src/services/share-links.ts` (or wherever ownership is computed).

## Checkpoints

Each checkpoint is independently shippable. Stop after any of them and the app still works.

### CP0 — Plan written ✅
- This document.

### CP1 — Shared `<ViewerModal>` component + CSS
- Build the component scaffolding with prop-driven rendering.
- Inject CSS via runtime style tag (deduped by id).
- Implement the curl synthesizer + a pure helper for drawer state.
- Wire merge dialog by re-using the existing `MergeDialog` from `components.tsx`.
- **Acceptance:**
  - `bun run --cwd packages/viewer-react build` ✅
  - `bun run --cwd packages/viewer-react typecheck` (or `bun run typecheck` from root) ✅
  - The new unit tests pass.
  - The component is exported from `@jittle-lamp/viewer-react`.
  - No app-level changes yet; both apps still build untouched.

### CP2 — Search-everywhere, drawer, right-click menu
- Confirm `buildSectionTimeline` already accepts a query for non-network sections (it does).
- Add the unified search input in the evidence pane header.
- Build the drawer (network detail body lifted from `viewer-pane.tsx`/`network-detail.tsx`).
- Build the context menu component + integrate with row-level `onContextMenu`.
- Add Copy CURL + Copy response handlers (callbacks fire upstream).
- **Acceptance:**
  - The unit tests pass for curl synthesis and drawer toggling.
  - Visual/storybook-style assertion: rendering the component with mock rows shows
    the tab UI, filters, and drawer correctly. Verified manually in dev.
  - Context menu suppresses native menu and closes on outside click/Escape (asserted in tests).

### CP3 — Header (title, tags, share/download actions)
- Render title + tag pills + a button cluster:
  - Always: Close
  - When `shareLinkUrl`: Copy share link
  - When `isOwner && !shareLinkUrl`: Create share link
  - When `onDownloadZip`: Download ZIP (label adapts)
- Logic for which buttons appear is purely a function of props; no business logic in the component.
- **Acceptance:**
  - Owner with no link: see Create + Download ZIP.
  - Owner with link: see Copy + Download ZIP.
  - Non-owner with link: see Copy + Download ZIP.
  - Non-owner no link: see Download ZIP only.
  - Manual click of each button fires the matching callback (assertion via test).

### CP4 — Apply to desktop
- Replace the inline JSX in `DesktopViewerOverlay` with `<ViewerModal>`.
- In `desktop-controller.ts` extend the controller to expose `isOwner`, `shareLinkUrl`,
  `tags`, drawer state, and context menu state. Wire `onCopyCurl/onCopyResponse`
  to navigator.clipboard via the existing `copyViewerValue`.
- Handle the existing OS-native context menu path: keep `bridge.showContextMenu` for
  the *Actions* section (merge/unmerge). For Network rows, use the new in-app context
  menu — Electron does not need to participate.
- Update `tests/desktop-viewer-layout.test.ts` to assert the new grid contract.
- **Acceptance:**
  - `bun run --cwd apps/desktop typecheck` ✅
  - `bun run --cwd apps/desktop build` ✅
  - Manual: open a session via Library, the modal renders the new layout, all
    interactions still work (timeline click/contextmenu/merge/unmerge/notes save/close/Escape).

### CP5 — Apply to webapp
- Refactor `EvidenceViewerPage` so the route renders the page shell + the modal.
- Delete `network-detail.tsx` (its content is now in the drawer).
- Reuse the existing fetch-on-resolve flow for `/share/:token`.
- For zip download on share: lazily fetch the recording bytes when the user clicks
  Download ZIP (we already have the archive in memory). If the bytes aren't yet
  fetched, show a small progress state on the button.
- **Acceptance:**
  - `bun run --cwd apps/evidence-web typecheck` ✅
  - `bun run --cwd apps/evidence-web build` ✅
  - Manual: drop a zip → modal opens with new layout. Visit a share link → modal opens.

### CP6 — Final verification
- Run repo-wide `bun run typecheck` and `bun test`.
- Re-run `bun run --cwd apps/desktop build` and `bun run --cwd apps/evidence-web build`.
- Update `assets/redesign-plan.md` only if any decisions there were invalidated.
- Update *this* file's **Status & next steps** to reflect what shipped.

## Status & next steps (resume from here)

- [x] CP0 — Plan written.
- [ ] CP1 — Shared `<ViewerModal>` component.
- [ ] CP2 — Search-everywhere, drawer, right-click menu.
- [ ] CP3 — Header actions.
- [ ] CP4 — Desktop integration.
- [ ] CP5 — Webapp integration.
- [ ] CP6 — Verification & doc update.

When picking this up:
1. Read decisions #1–#12 above.
2. Skim the **Component contract** section.
3. Check off the boxes under CP-N as you complete them; commit per checkpoint.

## Useful commands

```bash
# Build the shared package
bun run --cwd packages/viewer-react build

# Typecheck a single app
bun run --cwd apps/desktop typecheck
bun run --cwd apps/evidence-web typecheck

# Run a single test file
bun test tests/viewer-modal.test.ts

# Whole workspace
bun run typecheck
bun test
```
