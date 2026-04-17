# ADR 0001: Viewer Architecture Phase 1

- **Date:** 2026-04-17
- **Status:** Accepted (agreed)
- **Decision owners:** Desktop + Web viewer maintainers

## Context

We need to evolve the viewer architecture without breaking the current local-first/offline product guarantees, while enabling a React UI migration and shared behavior between desktop and web viewer surfaces.

## Decision

1. **Local/offline stays first-class (no regressions).**
   - Any architecture or UI change in this phase must preserve local file/session loading and offline usage for both desktop and web viewer paths.

2. **A shared headless viewer core is the source of behavior truth.**
   - Viewer state shaping, timeline/event normalization, and playback semantics are implemented in shared headless logic and consumed by both desktop and web adapters.

3. **React migration is incremental, not big-bang.**
   - We will replace UI slices progressively behind stable interfaces, keeping the current app functional at each step.

4. **Adapters are split by runtime.**
   - `desktop adapter`: filesystem/native bridge concerns.
   - `web adapter`: browser/file API concerns.
   - Both adapters call into the same shared headless core.

5. **Explicit non-goals for this phase.**
   - No extension capture pipeline rewrite.
   - No protocol/schema redesign beyond what is required for parity.
   - No attempt to fully unify desktop and web UI shells in one release.

## Done definition

This ADR phase is done when all of the following are true:

- Desktop and web viewers both use the shared headless core for core viewer behavior.
- Desktop and web adapters remain separate and runtime-specific.
- React migration lands incrementally with no large cutover release.
- **Parity requirements are met for desktop/web viewer behavior:**
  - Same session loading outcomes for valid bundles/folders.
  - Same timeline ordering and event grouping rules.
  - Same playback seek/step behavior for equivalent data.
  - Same handling of missing/corrupt artifacts (equivalent user-facing error states).
- Local/offline operation is preserved (no network dependency introduced for baseline viewing).

## Consequences

- We reduce long-term drift between desktop and web behavior.
- We can ship migration work in smaller, reversible increments.
- Adapter boundaries become clearer and easier to test independently.
