# Offline-first test scenarios

This document captures the automated gates that protect local/offline behavior while enabling additive remote loading strategies.

## Required scenarios

1. **Web local ZIP import works with network disabled**
   - Automated in `tests/session-strategies.test.ts`
   - Test: `local ZIP strategy works offline with fetch disabled`
   - Guard: local strategy must never depend on `fetch` or network availability.

2. **Desktop local session loading does not require auth**
   - Automated in `tests/session-strategies.test.ts`
   - Test: `local strategy metadata does not require auth configuration`
   - Guard: local folder strategy is always available without tokens or remote credentials.

3. **Remote mode remains additive**
   - Automated in `tests/session-strategies.test.ts`
   - Tests:
     - `remote ZIP strategy is additive and can load without auth`
     - `remote ZIP strategy forwards bearer auth when provided`
     - `remote desktop strategy supports optional auth while preserving shared ZIP handling`
   - Guard: remote strategy uses optional auth and reuses shared ZIP parsing behavior; it does not replace local flow.

## CI command

Run the full suite:

```bash
bun test
```

Or run only strategy gates:

```bash
bun test tests/session-strategies.test.ts
```
