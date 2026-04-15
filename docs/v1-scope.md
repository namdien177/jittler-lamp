# V1 scope and assumptions

## Product framing

`jittle-lamp` V1 is a greenfield, local-first scaffold for a Chromium-based recording workflow:

- extension runs in Chromium with MV3
- active tab is the capture boundary for V1
- output artifacts are a `recording.webm` video plus structured `session.events.json`
- data stays local/offline; no auth, cloud storage, or remote APIs
- desktop app is a local companion, not a sync backend

## Repository shape

- `apps/extension`: service worker + injectable content script + build script
- `apps/desktop`: Electrobun shell with a minimal library-oriented desktop surface
- `packages/shared`: canonical schemas, manifest helpers, and event contracts
- `tests`: smoke coverage for shared contracts and workspace assumptions

## Architectural decisions in V1

1. **Shared contracts first**  
   Event, session, and artifact schemas live in `packages/shared` so the extension and desktop app can evolve against the same model.

2. **Four-runtime MV3 recorder**  
   The extension uses:
   - popup for explicit start/stop/status
   - background service worker for canonical session control and debugger events
   - offscreen document for `MediaRecorder` ownership and local downloads export
   - content script for interaction capture and content-ready handshakes

3. **WebM + JSON output model**  
   Session metadata is modeled around a local bundle containing:
   - video artifact (`recording.webm`)
   - structured event log (`session.events.json`)
   - optional future attachments such as screenshots or exports

4. **Single active session, local-only**  
   V1 supports one active-tab session at a time, checkpoints active session state in session storage, and exports with `chrome.downloads` instead of any remote backend.

5. **Optional local companion writer**  
   A Bun-powered companion server can run on `127.0.0.1:48115` and save session artifacts directly into a configured folder on the same machine. The extension falls back to browser downloads if that companion is unavailable.
   The companion only accepts write requests from `chrome-extension://` origins and rejects ordinary web origins; it does not yet pin writes to a single extension ID. Folder configuration can be changed locally through the desktop app or CLI.

6. **Minimal desktop shell**  
   The desktop app exists to validate the shared bundle boundary and prepare for future import/review flows without becoming part of the recording pipeline.

7. **Feasible build validation now, packaging next**  
   The repository root build validates the desktop shell sources by bundling the Bun entry and main view assets. Electrobun remains configured for local dev/package flows, while deeper release packaging stays a follow-up concern.

## Explicitly out of scope for V1

- cloud services, auth, or collaboration
- MP4 conversion or post-processing
- desktop streaming IPC
- capture beyond the active tab

## Current V1 event coverage

- video capture from the active tab into `recording.webm`
- debugger-backed network events with request/response headers, cookies, `set-cookie` data, and best-effort request/response body capture
- debugger-backed console events
- debugger-backed runtime exceptions
- content-script interactions (`click`, `input`, `submit`, `navigation`)

## Current V1 privacy posture

- typed field values are not exported
- query strings and URL fragments are stripped before page URLs are stored
- network request URLs are preserved as captured
- network credentials, cookies, auth-bearing headers, and body payloads are preserved unmasked inside local-only network events when CDP exposes them
- network body capture is best-effort and records omission/truncation metadata when bodies are unavailable or exceed local capture limits
- exports require explicit browser save confirmation per artifact
- if the companion server is running, artifacts are written directly into its configured folder instead of using browser downloads

## Recommended next steps

1. Teach the desktop shell to import and inspect real local session folders.
2. Add richer event filtering and playback verification UI.
3. Improve recorder resilience around tab closes, debugger conflicts, and interrupted downloads.
4. Add screenshots or additional attachments without breaking the shared bundle contract.
