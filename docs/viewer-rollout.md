# Viewer release posture

## Current mode: React-only (no rollout gate)

The viewer now boots the React implementation directly on both surfaces:

- **Web**: `apps/evidence-web/src/app.ts`
- **Desktop**: `apps/desktop/src/mainview/app.tsx`

There is no runtime query/localStorage implementation switch and no legacy fallback path.

## Telemetry

Boot telemetry remains enabled to detect hard failures:

- `surface`: `web` or `desktop`
- `viewerImplementation`: `react`
- `phase`: `selected` | `booted` | `boot_failed`
- `timestamp`
- optional `error`

## Operational guidance

Because rollout gating has been removed, remediation for viewer regressions requires a code change and redeploy.
