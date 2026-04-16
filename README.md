# jittle-lamp

`jittle-lamp` is a local-first Jam.dev alternative built around a Chromium MV3 extension recorder, a macOS desktop companion/viewer, a small evidence web viewer, and a shared TypeScript package.

## Workspace layout

- `apps/extension` — Chromium MV3 extension recorder for active-tab capture orchestration and local export.
- `apps/desktop` — Electrobun desktop companion and local session viewer for folders and ZIP imports.
- `apps/evidence-web` — lightweight browser viewer for exported session bundles.
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
- a desktop viewer that can open local session folders, import ZIP bundles, save notes, and inspect the recorded timeline/network payloads
- a browser-based evidence viewer build for the same bundle shape

See `docs/v1-scope.md` for more detail.

## Commands

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run release:check-version
```

## How to use the software

### 1. Record a session with the extension

1. Run `bun run build` or `bun run --cwd apps/extension build`.
2. Open `chrome://extensions` in Chromium.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select `apps/extension/dist`.
5. Open an `http://` or `https://` page, open the extension popup, and press **Start**.
6. Interact with the page, then press **Stop**.

By default Chromium prompts you to save the local artifacts:

- `recording.webm`
- `session.events.json`

If the desktop companion server is running, the extension can write those artifacts directly into the configured output folder instead.

### 2. Use the desktop companion and viewer

The desktop app can act as both the optional localhost companion and the local session viewer.

- `bun run --cwd apps/desktop dev` starts the local companion server on `http://127.0.0.1:48115`
- `bun run --cwd apps/desktop set-output "/absolute/path"` updates the saved output folder
- `bun run --cwd apps/desktop package` builds a local macOS desktop app bundle

Inside the desktop app, the current UI supports:

- **Open Local…** to inspect a session folder
- **Import ZIP…** to open an exported ZIP bundle
- **Choose folder…** / **Open folder** in Settings to manage the companion output route
- session playback, timeline review, network detail inspection, tag editing, and note saving

### 3. Use the browser evidence viewer

Build the lightweight evidence viewer with:

```bash
bun run --cwd apps/evidence-web build
```

That emits a static viewer into `apps/evidence-web/dist` for opening exported session bundles in a browser-oriented UI.

## Release

### Automated release flow

This repo now includes GitHub Actions automation for stable releases.

- pushing a tag that matches `vX.Y.Z`
- on the current `main` branch HEAD
- with all workspace versions already synced to `X.Y.Z`

triggers a release workflow that:

1. runs `bun install`, `bun run release:check-version`, `bun run typecheck`, `bun test`, and `bun run build`
2. packages the Chromium extension into a release ZIP
3. builds a macOS desktop distribution artifact on `macos-14`
4. creates a GitHub Release with GitHub-generated release notes

The release notes/changelog are generated automatically by GitHub when the release is created. There is no manual changelog editing step in the normal tag flow.

### 1. Prepare a release version

Use the root version as the release source of truth. The extension manifest and desktop Electrobun config now read that root version automatically, and the workspace `package.json` files are checked for sync.

To bump versions before a release:

```bash
bun run release:set-version 0.1.1
bun install
```

Then commit the version bump, merge it to `main`, and create the release tag:

```bash
git tag v0.1.1
git push origin main --tags
```

### 2. Chromium extension release asset

The release workflow builds the extension from `apps/extension/dist` and publishes:

- `jittle-lamp-extension-vX.Y.Z.zip`

This ZIP is for **extract + Load unpacked** usage in Chromium-based browsers. It is not:

- a signed Chrome Web Store package
- a `.crx` package
- a Chrome Web Store publish flow

Local build commands remain:

```bash
bun run build
# or only the extension
bun run --cwd apps/extension build
```

That build generates the unpacked extension directory containing:

- `manifest.json`
- `background.js`
- `content.js`
- `offscreen.js`
- `popup.js`
- `popup.html`
- `popup.css`
- `offscreen.html`

To install the released extension ZIP:

1. Download `jittle-lamp-extension-vX.Y.Z.zip` from the GitHub Release.
2. Extract it.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted folder.

To install from a local build instead:

1. Open `chrome://extensions` or the equivalent extensions page in your Chromium-based browser.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select `apps/extension/dist`.

### 3. macOS desktop release asset

The release workflow builds a macOS desktop artifact on a macOS runner and publishes a filename that explicitly states whether it is signed:

- `jittle-lamp-desktop-vX.Y.Z-macos-arm64-signed.dmg`
- or `jittle-lamp-desktop-vX.Y.Z-macos-arm64-unsigned.dmg`

The current workflow always produces an **arm64** macOS artifact. It does not claim Intel/universal support.

#### Unsigned releases

If Apple signing credentials are not configured in GitHub Actions, the workflow still builds an unsigned DMG. That is useful for internal download/testing, but it is **not** the same thing as a frictionless public macOS installer.

Unsigned macOS releases may still be blocked by Gatekeeper after download. If needed, a user can remove quarantine manually after installing the app:

```bash
xattr -cr /Applications/jittle-lamp.app
```

#### Signed and notarized releases

If the required Apple credentials are available in GitHub Actions, the desktop build enables Electrobun code signing + notarization automatically and the published DMG filename switches to `signed`.

The workflow supports these secrets:

- `ELECTROBUN_DEVELOPER_ID`
- `ELECTROBUN_TEAMID`
- either `ELECTROBUN_APPLEID` + `ELECTROBUN_APPLEIDPASS`
- or `ELECTROBUN_APPLEAPIKEY` + `ELECTROBUN_APPLEAPIISSUER` + `ELECTROBUN_APPLE_API_KEY_P8`

The API-key path is preferred for CI. The workflow writes `ELECTROBUN_APPLE_API_KEY_P8` into a temporary `.p8` file and points Electrobun at it automatically.

Local desktop packaging commands remain:

```bash
bun run --cwd apps/desktop package
bun run --cwd apps/desktop package:stable
```

With the checked-in config, Electrobun writes build output into:

- `apps/desktop/build/`
- `apps/desktop/artifacts/`

The release workflow collects the install-oriented artifact from `apps/desktop/artifacts/`.

### 4. Release notes specific to this repo

- The release workflow only accepts stable tags that match `vX.Y.Z`.
- The tag must point at the current `main` HEAD.
- `bun run release:check-version` fails if any workspace package version drifts from the root release version.
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
