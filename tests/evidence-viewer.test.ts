import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { strToU8, unzipSync, zipSync } from "fflate";

import { _testOverrideDb, getSessionNotes, loadLibrarySession, scanLibrarySessions, setSessionNotes } from "../apps/desktop/src/companion/sessions-db";
import { buildSessionZip, clearTempSession, importZipBundle, loadLocalSession } from "../apps/desktop/src/bun/zip-import";

const NOW = new Date("2024-06-01T12:00:00.000Z").toISOString();
const SESSION_ID = "jl_test_session_001";

const VALID_BUNDLE = {
  schemaVersion: 2,
  sessionId: SESSION_ID,
  name: "Test Session",
  createdAt: NOW,
  updatedAt: NOW,
  phase: "ready",
  page: {
    url: "https://example.com/",
    title: "Example"
  },
  artifacts: [
    { kind: "recording.webm", relativePath: `${SESSION_ID}/recording.webm`, mimeType: "video/webm" },
    { kind: "session.events.json", relativePath: `${SESSION_ID}/session.events.json`, mimeType: "application/json" }
  ],
  events: [
    {
      at: NOW,
      payload: { kind: "lifecycle", phase: "ready", detail: "Session complete." }
    }
  ],
  notes: []
};

function makeZip(bundleOverride?: object): Uint8Array {
  const bundle = bundleOverride ?? VALID_BUNDLE;
  const eventsBytes = strToU8(JSON.stringify(bundle));
  const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

  return zipSync({
    "session.events.json": eventsBytes,
    "recording.webm": webmBytes
  });
}

describe("scanLibrarySessions", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = join(tmpdir(), `jl-test-scan-${Date.now()}`);
    await mkdir(outputDir, { recursive: true });
    _testOverrideDb(":memory:");
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  test("returns a SessionRecord for a valid session folder", async () => {
    const sessionFolder = join(outputDir, SESSION_ID);
    await mkdir(sessionFolder, { recursive: true });
    await writeFile(join(sessionFolder, "session.events.json"), JSON.stringify(VALID_BUNDLE));
    await writeFile(join(sessionFolder, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    const records = await scanLibrarySessions(outputDir);

    expect(records).toHaveLength(1);
    expect(records[0]!.sessionId).toBe(SESSION_ID);
    expect(records[0]!.recordedAt).toBe(NOW);
    expect(records[0]!.tags).toEqual([]);
    expect(records[0]!.notes).toBe("");
    expect(records[0]!.artifacts).toHaveLength(2);
  });

  test("skips folders missing recording.webm", async () => {
    const sessionFolder = join(outputDir, SESSION_ID);
    await mkdir(sessionFolder, { recursive: true });
    await writeFile(join(sessionFolder, "session.events.json"), JSON.stringify(VALID_BUNDLE));

    const records = await scanLibrarySessions(outputDir);
    expect(records).toHaveLength(0);
  });

  test("skips folders with invalid session.events.json", async () => {
    const sessionFolder = join(outputDir, SESSION_ID);
    await mkdir(sessionFolder, { recursive: true });
    await writeFile(join(sessionFolder, "session.events.json"), JSON.stringify({ bad: "data" }));
    await writeFile(join(sessionFolder, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    const records = await scanLibrarySessions(outputDir);
    expect(records).toHaveLength(0);
  });

  test("skips folders with malformed JSON", async () => {
    const sessionFolder = join(outputDir, SESSION_ID);
    await mkdir(sessionFolder, { recursive: true });
    await writeFile(join(sessionFolder, "session.events.json"), "not json {{{{");
    await writeFile(join(sessionFolder, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    const records = await scanLibrarySessions(outputDir);
    expect(records).toHaveLength(0);
  });

  test("returns empty array when outputDir does not exist", async () => {
    const records = await scanLibrarySessions(join(tmpdir(), "jl-nonexistent-dir-xyz"));
    expect(records).toHaveLength(0);
  });

  test("joins notes from SQLite when present", async () => {
    const sessionFolder = join(outputDir, SESSION_ID);
    await mkdir(sessionFolder, { recursive: true });
    await writeFile(join(sessionFolder, "session.events.json"), JSON.stringify(VALID_BUNDLE));
    await writeFile(join(sessionFolder, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    setSessionNotes(SESSION_ID, "My test note");

    const records = await scanLibrarySessions(outputDir);
    expect(records[0]!.notes).toBe("My test note");
  });
});

describe("loadLibrarySession", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = join(tmpdir(), `jl-test-load-${Date.now()}`);
    await mkdir(outputDir, { recursive: true });
    _testOverrideDb(":memory:");
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  test("returns a ViewerPayload with source=library for a valid session", async () => {
    const sessionFolder = join(outputDir, SESSION_ID);
    await mkdir(sessionFolder, { recursive: true });
    await writeFile(join(sessionFolder, "session.events.json"), JSON.stringify(VALID_BUNDLE));
    await writeFile(join(sessionFolder, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    const payload = await loadLibrarySession(SESSION_ID, outputDir);

    expect(payload.source).toBe("library");
    expect(payload.bundle.sessionId).toBe(SESSION_ID);
    expect(payload.bundle.schemaVersion).toBe(2);
    expect(payload.videoPath).toEndWith("recording.webm");
    expect(payload.notes).toBe("");
    expect(payload.tempId).toBeUndefined();
  });

  test("includes persisted notes in the payload", async () => {
    const sessionFolder = join(outputDir, SESSION_ID);
    await mkdir(sessionFolder, { recursive: true });
    await writeFile(join(sessionFolder, "session.events.json"), JSON.stringify(VALID_BUNDLE));
    await writeFile(join(sessionFolder, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    setSessionNotes(SESSION_ID, "Reviewer note here");

    const payload = await loadLibrarySession(SESSION_ID, outputDir);
    expect(payload.notes).toBe("Reviewer note here");
  });

  test("throws when session folder does not exist", async () => {
    try {
      await loadLibrarySession("nonexistent-session", outputDir);
      throw new Error("Expected loadLibrarySession to throw for a missing session.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  test("throws when session.events.json is invalid", async () => {
    const sessionFolder = join(outputDir, SESSION_ID);
    await mkdir(sessionFolder, { recursive: true });
    await writeFile(join(sessionFolder, "session.events.json"), JSON.stringify({ bad: true }));
    await writeFile(join(sessionFolder, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    try {
      await loadLibrarySession(SESSION_ID, outputDir);
      throw new Error("Expected loadLibrarySession to reject invalid bundle JSON.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("validation failed");
    }
  });

  test("rejects path traversal sessionId", async () => {
    try {
      await loadLibrarySession("../etc/passwd", outputDir);
      throw new Error("Expected loadLibrarySession to reject path traversal.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("path traversal");
    }
  });
});

describe("setSessionNotes / getSessionNotes", () => {
  beforeEach(() => {
    _testOverrideDb(":memory:");
  });

  test("returns empty string for unknown session", () => {
    expect(getSessionNotes("unknown-session")).toBe("");
  });

  test("stores and retrieves notes", () => {
    setSessionNotes("sess-1", "Hello notes");
    expect(getSessionNotes("sess-1")).toBe("Hello notes");
  });

  test("overwrites existing notes on second call", () => {
    setSessionNotes("sess-1", "First");
    setSessionNotes("sess-1", "Second");
    expect(getSessionNotes("sess-1")).toBe("Second");
  });

  test("notes are isolated per session", () => {
    setSessionNotes("sess-a", "Note A");
    setSessionNotes("sess-b", "Note B");
    expect(getSessionNotes("sess-a")).toBe("Note A");
    expect(getSessionNotes("sess-b")).toBe("Note B");
  });
});

describe("importZipBundle", () => {
  test("returns a ViewerPayload with source=zip", async () => {
    const zip = makeZip();
    const payload = await importZipBundle(zip);

    expect(payload.source).toBe("zip");
    expect(payload.bundle.sessionId).toBe(SESSION_ID);
    expect(payload.bundle.schemaVersion).toBe(2);
    expect(payload.videoPath).toContain("jittle-lamp-temp");
    expect(payload.videoPath).toEndWith(".webm");
    expect(payload.notes).toBe("");
    expect(payload.tempId).toBeString();
    expect(payload.tempId!.length).toBeGreaterThan(0);

    const fileStat = await stat(payload.videoPath);
    expect(fileStat.isFile()).toBe(true);

    await clearTempSession(payload.tempId!);
  });

  test("throws when session.events.json is missing from ZIP", async () => {
    const webmBytes = new Uint8Array([0x1a, 0x45]);
    const zip = zipSync({ "recording.webm": webmBytes });

    try {
      await importZipBundle(zip);
      throw new Error("Expected importZipBundle to reject when session.events.json is missing.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("ZIP is missing session.events.json");
    }
  });

  test("throws when recording.webm is missing from ZIP", async () => {
    const eventsBytes = strToU8(JSON.stringify(VALID_BUNDLE));
    const zip = zipSync({ "session.events.json": eventsBytes });

    try {
      await importZipBundle(zip);
      throw new Error("Expected importZipBundle to reject when recording.webm is missing.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("ZIP is missing recording.webm");
    }
  });

  test("throws when session.events.json fails schema validation", async () => {
    const zip = makeZip({ schemaVersion: 99, bad: "data" });
    try {
      await importZipBundle(zip);
      throw new Error("Expected importZipBundle to reject invalid session bundle JSON.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("Invalid session bundle");
    }
  });

  test("each import gets a unique tempId", async () => {
    const zip = makeZip();
    const [a, b] = await Promise.all([importZipBundle(zip), importZipBundle(zip)]);

    expect(a.tempId).not.toBe(b.tempId);

    await Promise.all([clearTempSession(a.tempId!), clearTempSession(b.tempId!)]);
  });

  test("ZIP payload has no notes and is not editable via setSessionNotes", () => {
    const zip = makeZip();
    void importZipBundle(zip).then(async (payload) => {
      expect(payload.source).toBe("zip");
      expect(payload.notes).toBe("");
      await clearTempSession(payload.tempId!);
    });
  });
});

describe("clearTempSession", () => {
  test("deletes the temp video file", async () => {
    const zip = makeZip();
    const payload = await importZipBundle(zip);
    const { videoPath } = payload;

    const before = await stat(videoPath).catch(() => null);
    expect(before?.isFile()).toBe(true);

    await clearTempSession(payload.tempId!);

    const after = await stat(videoPath).catch(() => null);
    expect(after).toBeNull();
  });

  test("is a no-op for an unknown tempId", async () => {
    await clearTempSession("nonexistent-id");
    expect(true).toBeTrue();
  });
});

describe("loadLocalSession", () => {
  let folderPath: string;

  beforeEach(async () => {
    folderPath = join(tmpdir(), `jl-test-local-${Date.now()}`);
    await mkdir(folderPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(folderPath, { recursive: true, force: true });
  });

  test("returns a ViewerPayload with source=local for a valid folder", async () => {
    await writeFile(join(folderPath, "session.events.json"), JSON.stringify(VALID_BUNDLE));
    await writeFile(join(folderPath, "recording.webm"), new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));

    const payload = await loadLocalSession(folderPath);

    expect(payload.source).toBe("local");
    expect(payload.bundle.sessionId).toBe(SESSION_ID);
    expect(payload.bundle.schemaVersion).toBe(2);
    expect(payload.videoPath).toEndWith("recording.webm");
    expect(payload.notes).toBe("");
    expect(payload.tempId).toBeUndefined();
  });

  test("videoPath points to the original file, no temp copy created", async () => {
    await writeFile(join(folderPath, "session.events.json"), JSON.stringify(VALID_BUNDLE));
    await writeFile(join(folderPath, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    const payload = await loadLocalSession(folderPath);

    expect(payload.videoPath).toBe(join(folderPath, "recording.webm"));
    expect(payload.videoPath).not.toContain("jittle-lamp-temp");
  });

  test("notes are always empty for local sessions", async () => {
    await writeFile(join(folderPath, "session.events.json"), JSON.stringify(VALID_BUNDLE));
    await writeFile(join(folderPath, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    const payload = await loadLocalSession(folderPath);

    expect(payload.notes).toBe("");
  });

  test("throws when session.events.json is missing", async () => {
    await writeFile(join(folderPath, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    try {
      await loadLocalSession(folderPath);
      throw new Error("Expected loadLocalSession to throw for missing session.events.json.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("missing session.events.json");
    }
  });

  test("throws when recording.webm is missing", async () => {
    await writeFile(join(folderPath, "session.events.json"), JSON.stringify(VALID_BUNDLE));

    try {
      await loadLocalSession(folderPath);
      throw new Error("Expected loadLocalSession to throw for missing recording.webm.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("missing recording.webm");
    }
  });

  test("throws when session.events.json fails schema validation", async () => {
    await writeFile(join(folderPath, "session.events.json"), JSON.stringify({ bad: "data" }));
    await writeFile(join(folderPath, "recording.webm"), new Uint8Array([0x1a, 0x45]));

    try {
      await loadLocalSession(folderPath);
      throw new Error("Expected loadLocalSession to reject invalid bundle JSON.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain("Invalid session bundle");
    }
  });
});

describe("buildSessionZip / export round-trip", () => {
  let folderPath: string;

  beforeEach(async () => {
    folderPath = join(tmpdir(), `jl-test-export-${Date.now()}`);
    await mkdir(folderPath, { recursive: true });
    await writeFile(join(folderPath, "session.events.json"), JSON.stringify(VALID_BUNDLE));
    await writeFile(join(folderPath, "recording.webm"), new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
  });

  afterEach(async () => {
    await rm(folderPath, { recursive: true, force: true });
  });

  test("produces a non-empty Uint8Array with a valid ZIP signature", async () => {
    const zipBytes = await buildSessionZip(folderPath);

    expect(zipBytes).toBeInstanceOf(Uint8Array);
    expect(zipBytes.length).toBeGreaterThan(0);
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
  });

  test("exported ZIP contains exactly recording.webm and session.events.json at root", async () => {
    const zipBytes = await buildSessionZip(folderPath);

    const files = unzipSync(zipBytes);
    const keys = Object.keys(files).sort();

    expect(keys).toEqual(["recording.webm", "session.events.json"]);
  });

  test("export round-trip: buildSessionZip then importZipBundle produces identical bundle", async () => {
    const zipBytes = await buildSessionZip(folderPath);
    const payload = await importZipBundle(zipBytes);

    expect(payload.source).toBe("zip");
    expect(payload.bundle.sessionId).toBe(SESSION_ID);
    expect(payload.bundle.schemaVersion).toBe(2);
    expect(payload.bundle.createdAt).toBe(NOW);

    const videoStat = await stat(payload.videoPath);
    expect(videoStat.size).toBe(4);

    await clearTempSession(payload.tempId!);
  });

  test("round-trip preserves the original webm bytes exactly", async () => {
    const originalBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

    const zipBytes = await buildSessionZip(folderPath);
    const files = unzipSync(zipBytes);

    expect(files["recording.webm"]).toEqual(originalBytes);
  });

  test("throws when recording.webm is missing from the source folder", async () => {
    await rm(join(folderPath, "recording.webm"), { force: true });

    try {
      await buildSessionZip(folderPath);
      throw new Error("Expected buildSessionZip to throw for missing recording.webm.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });
});
