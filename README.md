# jittle-lamp

`jittle-lamp` is a local-first Jam.dev alternative built around a Chromium MV3 extension, a shared TypeScript package, and a minimal Electrobun desktop companion.

## Workspace layout

- `apps/extension` — Chromium MV3 extension recorder for active-tab capture orchestration and local export.
- `apps/desktop` — Electrobun desktop shell for local session import and later playback/review.
- `packages/shared` — strict TypeScript schemas and helpers shared by the extension and desktop app.
- `docs` — scope, assumptions, and architecture notes for V1.
- `tests` — repository-level smoke tests.

## V1 scope

V1 now implements a local-only recorder path with:

- strict TypeScript workspace configuration
- Bun workspace scripts for build, typecheck, and test
- MV3 popup/background/content/offscreen runtimes aligned to one active-tab session at a time
- shared event/session/message schemas designed around `WebM + JSON` local artifacts
- browser-download export into a per-session folder (`<sessionId>/recording.webm` and `<sessionId>/session.events.json`)
- sanitized page URLs and interaction metadata without raw typed field values
- richer debugger-backed network events including request/response headers, cookies, bodies, and best-effort omission/truncation metadata
- optional local companion server that writes artifacts directly into a configured machine folder
- a minimal desktop shell that validates the same shared bundle shape used by the extension

See `docs/v1-scope.md` for more detail.

## Commands

```bash
bun install
bun run typecheck
bun run test
bun run build
```

## Release

### 1. Chromium extension release

This repo builds the extension into a Chromium-loadable MV3 folder at:

- `apps/extension/dist`

Build it with either of these commands:

```bash
bun run build
# or only the extension
bun run --cwd apps/extension build
```

That build generates a release-ready unpacked extension directory containing:

- `manifest.json`
- `background.js`
- `content.js`
- `offscreen.js`
- `popup.js`
- `popup.html`
- `popup.css`
- `offscreen.html`

To install it into a Chromium browser:

1. Open `chrome://extensions` or the equivalent extensions page in your Chromium-based browser.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select `apps/extension/dist`.

If you want to share a release artifact internally, zip the contents of `apps/extension/dist` and have the recipient extract it before using **Load unpacked**. This repo does **not** currently define:

- a signed Chrome Web Store package flow
- a `.crx` packaging flow
- a publish/release automation flow

So the documented release target today is the unpacked build folder.

### 2. macOS `.app` release

The desktop app is packaged through Electrobun using:

- `apps/desktop/electrobun.config.ts`
- `bun run --cwd apps/desktop package`

The basic packaging command is:

```bash
bun run --cwd apps/desktop package
```

That is the repo-defined release hook for creating the standalone macOS application bundle.

#### Unsigned / local-use build

The current repo does not check in signing or notarization settings, so the default packaging path should be treated as the local or unsigned build path.

Use:

```bash
bun run --cwd apps/desktop package
```

Notes:

- this is the correct path for local testing and internal packaging experiments
- if an unsigned app is downloaded from another machine, macOS Gatekeeper may block it until quarantine is removed
- if needed, you can clear quarantine manually on macOS with:

```bash
xattr -cr /Applications/jittle-lamp.app
```

#### Signed / distributable build

For a proper distributable macOS release, you need to add Electrobun signing/notarization configuration and provide Apple credentials before running the same package command.

At a high level:

1. Add the relevant macOS signing/notarization settings to `apps/desktop/electrobun.config.ts`.
2. Provide your Apple Developer signing credentials and team configuration through the environment Electrobun expects.
3. Re-run:

```bash
bun run --cwd apps/desktop package
```

Repo caveat: the current project does **not** yet check in a completed signing/notarization setup, artifact naming convention, or publish pipeline for the macOS app. So the release section should describe the package command and clearly state that signing is a configuration step you still need to add for public distribution.

### 3. Release notes specific to this repo

- The root `bun run build` command is the workspace build/validation path. It is not the same thing as desktop packaging.
- The extension version and desktop version are currently kept in multiple files manually, so version bumps should be done carefully before a release.
- The extension companion integration assumes the local companion server runs on `http://127.0.0.1:48115`.
- The desktop companion output folder can be changed locally through the desktop UI or the CLI helper:

```bash
bun run --cwd apps/desktop set-output "/absolute/path"
```

For the desktop app specifically:

- `bun run --cwd apps/desktop dev` starts the local companion server on `http://127.0.0.1:48115`.
- `bun run --cwd apps/desktop set-output "/absolute/path"` changes the folder where the companion writes sessions.
- `bun run --cwd apps/desktop package` attempts an Electrobun package build.
- `bun run --cwd apps/desktop build` performs the repository's lightweight desktop shell build validation used by the workspace root.

The companion only accepts artifact writes from `chrome-extension://` origins and rejects normal web origins. It does not currently pin a single extension ID. Output-folder changes happen locally through the desktop app or CLI, not over HTTP.

## Extension workflow

1. Run `bun run build` or `bun run --cwd apps/extension build`.
2. Optional but recommended: run `bun run --cwd apps/desktop set-output "/absolute/path"` once.
3. Start the local companion with `bun run --cwd apps/desktop dev` if you want artifacts written directly into that folder.
4. Load `apps/extension/dist` as an unpacked extension in Chromium.
5. Open an `http://` or `https://` tab and open the extension popup.
6. Press **Start** and grant site access when prompted so capture can survive normal navigations.
7. Interact with the page, then press **Stop**.
8. If the companion server is running, artifacts are written to the configured folder. Otherwise Chromium prompts you to save the local session artifacts:
   - `recording.webm`
   - `session.events.json`

### Recorder architecture

- **popup**: start/stop/status UI
- **background**: canonical session controller, storage checkpointing, and debugger bridge
- **offscreen document**: `MediaRecorder`, chunk aggregation, and local downloads export
- **desktop companion server**: optional localhost writer for a user-configurable artifact folder
- **content script**: content-ready + interaction capture (`click`, `input`, `submit`, `navigation`)

The exported JSON is the shared `SessionBundle` object rather than a bare event array. V1 intentionally avoids raw typed field values, strips query/hash fragments from captured page URLs, preserves network request URLs as captured by the browser, and keeps captured network credentials/cookies unmasked inside the local-only network payload path.

### Expanded network capture

When the Chrome debugger is attached, the recorder now exports richer per-request network events built from the existing CDP path:

- request headers and associated cookies
- request post data / body when CDP exposes it
- response headers plus parsed `set-cookie` headers/cookies
- response bodies captured after `Network.loadingFinished`
- omission/truncation metadata when bodies are unavailable or too large to store in-session

The popup still shows session status locally, but it now receives a typed active-session summary instead of the full live event draft so larger sessions do not obviously break the popup path.
