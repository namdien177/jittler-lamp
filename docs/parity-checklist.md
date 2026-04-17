# Desktop + Evidence Web parity checklist

Use this single checklist for both manual QA verification and automated coverage tracking.

## Coverage task ID index

| Task ID | Scope | Covered by automated tests |
| --- | --- | --- |
| PARITY-ZIP-01 | ZIP load validation (required files + schema errors) | `tests/evidence-viewer.test.ts` → `importZipBundle` tests: missing `session.archive.json`, missing `recording.webm`, schema validation failure, nested paths accepted |
| PARITY-TL-01 | Timeline rendering and active-item progression | `tests/timeline.test.ts` → `buildTimeline` (offset/sort/labels) + `findActiveIndex` (most recent visible item tracking) |
| PARITY-MERGE-01 | Merge/unmerge visibility and contiguous selection rules | `tests/timeline.test.ts` → `buildVisibleActionRows`, `buildVisibleActionRangeSelection`, `getContiguousMergeableActionIds`; `tests/viewer-core.test.ts` → `applyArchiveToViewerCore` hydrates merge groups |
| PARITY-NET-01 | Network filtering/search behavior (plain text + regex) | `tests/timeline.test.ts` → `buildSectionTimeline network search` |
| PARITY-EXPORT-01 | Export updated ZIP behavior + schema fidelity | `tests/evidence-viewer.test.ts` → `buildReviewedArchive` + `buildReviewedSessionZip`; `tests/session-contracts.test.ts` → schema version + network payload fidelity checks |

## QA parity checklist

### 1) ZIP load validation behavior

- [ ] **Desktop app**: importing ZIP fails fast on missing `session.archive.json`, missing `recording.webm`, and invalid schema payloads. (Task: `PARITY-ZIP-01`)
- [ ] **Evidence web app**: loading ZIP accepts nested session paths and rejects malformed bundle structure. (Task: `PARITY-ZIP-01`)

### 2) Timeline rendering + active item tracking

- [ ] **Desktop app**: timeline rows render in chronological offset order with stable labels by event type. (Task: `PARITY-TL-01`)
- [ ] **Evidence web app**: active timeline item advances to the most recent visible event as playback time progresses. (Task: `PARITY-TL-01`)

### 3) Merge/unmerge behavior

- [ ] **Desktop app**: merged actions collapse into one visible row and selection respects visible-row ordering. (Task: `PARITY-MERGE-01`)
- [ ] **Evidence web app**: merge operations only allow contiguous, currently unmerged actions; merged/skipped rows are rejected. (Task: `PARITY-MERGE-01`)

### 4) Network filtering/search behavior

- [ ] **Desktop app**: network view filtering matches URL, headers, and captured response content for plain-text queries. (Task: `PARITY-NET-01`)
- [ ] **Evidence web app**: network view filtering supports regex queries with equivalent match semantics. (Task: `PARITY-NET-01`)

### 5) Export updated ZIP behavior and schema fidelity

- [ ] **Desktop app**: saving review state writes notes/annotations back to `session.archive.json` with valid schema fields. (Task: `PARITY-EXPORT-01`)
- [ ] **Evidence web app**: reviewed ZIP export preserves `recording.webm`, updates `updatedAt`, and round-trips merge annotations. (Task: `PARITY-EXPORT-01`)
