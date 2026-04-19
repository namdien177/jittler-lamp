# Viewer rollout + rollback playbook

## Runtime feature flags

We can switch viewer implementations without redeploying capture logic by changing runtime flags:

- **Web**
  - Query override: `?viewer=react` or `?viewer=legacy`
  - Persisted flag: `localStorage['jl.viewer.web.implementation']`
- **Desktop**
  - Query override: `?viewer=react` or `?viewer=legacy`
  - Persisted flag: `localStorage['jl.viewer.desktop.implementation']`

Resolution order is always:
1. Query string override (highest priority)
2. Local storage value
3. Safe default: `legacy`

## Fast fallback behavior

If `react` is selected and viewer boot fails:

- Web immediately boots legacy implementation in the same session.
- Desktop immediately flips to legacy implementation in memory and continues rendering.

## Telemetry

We emit rollout telemetry for both surfaces with:

- `surface`: `web` or `desktop`
- `viewerImplementation`: `react` or `legacy`
- `phase`: `selected` | `booted` | `boot_failed` | `fallback`
- `timestamp`
- optional `error`

## Rollback procedure

1. Set runtime flag to legacy on affected surface (`?viewer=legacy` for immediate override).
2. Verify viewer opens with expected timeline and playback.
3. Monitor telemetry for `phase=fallback` and `phase=boot_failed` until stable.
4. Remove query override once validated; keep storage default on `legacy` during stabilization window.

## Tested checklist

- Resolver precedence + safe-default behavior is covered by automated tests in `tests/viewer-rollout.test.ts`.
- Manual smoke test:
  - open with `?viewer=react`
  - open with `?viewer=legacy`
  - remove query and validate storage/default behavior.
