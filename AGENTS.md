# Repository Guidelines

## Project Structure & Module Organization

This is a Bun workspace. Application code lives in `apps/`: `extension` for the Chromium extension, `desktop` for the companion shell, `evidence-web` for the web viewer, and `backend` for the Elysia API. Shared libraries live in `packages/`: `shared` contains session schemas and timeline logic, `viewer-core` contains viewer state helpers, and `viewer-react` contains reusable React components. Cross-package tests are in root `tests/`; backend-specific tests are in `apps/backend/test/`. Static/sample assets live in `assets/`, docs in `docs/`, and release utilities in `scripts/release/`.

## Build, Test, and Development Commands

- `bun run build`: builds shared packages, viewer packages, extension, desktop scaffold, and web viewer.
- `bun run typecheck`: runs TypeScript over the full workspace.
- `bun test`: runs all Bun tests.
- `bun run --cwd apps/extension build`: rebuilds unpacked extension assets into `apps/extension/dist/`.
- `bun run --cwd apps/backend dev`: starts the backend in watch mode.
- `bun run --cwd apps/backend lint`: runs Biome checks for backend `src` and `test`.
- `bun run clean`: removes generated dist/release artifacts.

## Coding Style & Naming Conventions

Use TypeScript ESM. Prefer explicit schema validation with Zod for persisted or cross-process payloads. Keep file names kebab-case for app modules (`network-detail.tsx`, `session-strategy.ts`) and tests as `*.test.ts`. Follow existing two-space JSON formatting; backend formatting/linting is managed by Biome (`bun run --cwd apps/backend lint:fix`). Keep browser-extension changes scoped across `background.ts`, `content.ts`, and schemas in `packages/shared/src/extension.ts`.

## Testing Guidelines

Tests use Bun’s test runner. Add focused unit or contract tests near the behavior boundary: schemas in `tests/extension-contracts.test.ts`, session archive behavior in `tests/session-contracts.test.ts`, timeline labels/filtering in `tests/timeline.test.ts`, and recovery/background behavior in `tests/background-recovery.test.ts`. Run targeted tests during development, then `bun run typecheck` and `bun test` before opening a PR.

## Commit & Pull Request Guidelines

Recent commits use concise imperative subjects, often with a scope, for example `backend: add team-policy hooks...` or `fix backend drizzle and biome config`. Keep commits focused and mention PR numbers only when GitHub adds them. PRs should include a short problem statement, implementation summary, tests run, and screenshots or recordings for UI/extension behavior changes.

## Security & Configuration Tips

Do not commit secrets, local certificates, `.env` files, or generated release bundles. Extension permission changes must update `apps/extension/scripts/manifest.ts` and be called out in the PR.
