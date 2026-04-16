# Draft: Desktop App Redesign

## Requirements (confirmed)
- Actions: browse/filter/tag/open/delete only (no rename, bulk, export, archive)
- Tags: free-text with autocomplete from previously used tags
- Date: receive time (`recordedAt`) is fine — no need to parse session.events.json
- Scale: 200-1000 sessions — client-side filtering is fine but should be efficient
- Settings: gear icon → slide-out drawer
- Dark mode: retain, already exists
- Extension popup: minor polish only
- Main desktop files to modify: `apps/desktop/src/mainview/app.ts`, `apps/desktop/src/mainview/index.css`, `apps/desktop/src/companion/sessions-db.ts`, `apps/desktop/src/rpc.ts`, `apps/desktop/src/bun/index.ts`
- Extension file to modify: `apps/extension/src/popup.css`

## Technical Decisions
- Planning target is a desktop redesign implemented in vanilla TypeScript with `innerHTML` templating, plain CSS, Electrobun RPC, and SQLite-backed tags
- Plan should include ordered steps, parallelization, per-step files/changes/dependencies, risks/mitigations, complexity, atomic commits, and TDD orientation
- Preserve current architectural baseline unless intentionally replaced: single renderer file, `data-role` selectors, imperative DOM mutation, typed narrow RPC requests, explicit choose/save output-folder flow, and polling-based refresh
- Preserve existing inline two-click delete confirmation flow and adapt it to the redesigned session cards
- Use client-side filtering over the fetched session list; target scale (200-1000 sessions) does not require server-side filtering
- Keep dark mode via existing token system; redesign should rewrite styles but retain the dark theme
- Settings drawer should remain non-routing local UI state in `app.ts`, not a new framework/module system
- Tag persistence should be added in SQLite using a `session_tags` table keyed by `session_id` + normalized tag value, then exposed through RPC and included in `SessionRecord.tags`
- TDD orientation should cover DB behavior, RPC handlers, and extracted pure UI/filter logic first; desktop renderer behavior can be validated with DOM-oriented tests if test harness support exists, otherwise via targeted integration/QA scenarios

## Research Findings
- Repo baseline:
  - `apps/desktop/src/mainview/app.ts` is a single-file renderer that injects shell HTML, queries elements once, re-renders sections, and polls runtime/sessions every 2s
  - `apps/desktop/src/mainview/index.css` is dark-only and already defines the token family to preserve
  - `apps/desktop/src/rpc.ts` and `apps/desktop/src/bun/index.ts` use narrow typed request/response RPC handlers with renderer → Bun request calls only
  - `apps/desktop/src/companion/sessions-db.ts` stores artifact rows in SQLite, reads all rows, groups in memory, sorts by `recordedAt DESC`, and deletes by `session_id`
  - Delete UX already uses inline two-click confirm with a 3-second timeout
  - Output-folder config uses explicit choose/save separation and env override precedence from `companion/config.ts`
- Tests/config baseline:
  - No desktop renderer tests exist today
  - Relevant existing coverage is contract-level only in `tests/extension-contracts.test.ts` and `tests/session-contracts.test.ts`
  - Desktop build copies HTML/CSS as-is and bundles TS, so CSS rewrite can stay plain and standalone
- External guidance:
  - Bun SQLite supports straightforward schema/index creation and favors prepared statements/transactions for repeated writes
  - Accessible inline tag entry should follow combobox + listbox semantics with keyboard support (`ArrowUp/Down`, `Enter`, `Escape`)
  - Slide-out drawer should behave like a dialog/disclosure hybrid with `aria-expanded`, focus handoff, escape-to-close, and focus trapping
  - Bun test runner can cover TS directly; Happy DOM/testing-library style setup is the likely path if DOM tests are added

## Open Questions
- No blocking user questions remain for plan generation; apply defaults where needed
- Default candidate: session folder path shown on hover/focus with a stable reserved row to avoid card jumpiness
- Default candidate: tag matching/filtering is case-insensitive; storage is normalized/trimmed for uniqueness while display preserves the entered label form where possible
- Default candidate: only one inline tag editor may be active at a time to simplify focus and autocomplete state

## Scope Boundaries
- INCLUDE: desktop mainview redesign, session tag persistence and RPC, popup polish
- EXCLUDE: rename, bulk actions, export, archive, session.events.json parsing
