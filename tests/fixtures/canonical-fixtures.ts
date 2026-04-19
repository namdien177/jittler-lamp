import { strToU8, zipSync, type Zippable } from "fflate";
import { createSessionArchive, createSessionDraft, sessionArchiveSchema, type SessionArchive, type SessionEvent } from "@jittle-lamp/shared";

export const CANONICAL_NOW = "2024-06-01T12:00:00.000Z";
export const CANONICAL_SESSION_ID = "jl_fixture_session_001";

const ZIP_RECORDING_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

function makeActionEvents(count: number): SessionEvent[] {
  return Array.from({ length: count }, (_value, index) => {
    const at = new Date(new Date(CANONICAL_NOW).getTime() + index * 1000).toISOString();
    return {
      at,
      payload: {
        kind: "interaction" as const,
        type: "click" as const,
        selector: `#action-${index}`
      }
    };
  });
}

function networkEdgeCaseEvents(): SessionEvent[] {
  return [
    {
      at: "2024-06-01T12:01:00.000Z",
      payload: {
        kind: "network",
        method: "POST",
        url: "https://example.com/api/graphql",
        subtype: "fetch",
        request: {
          headers: [{ name: "content-type", value: "application/json; charset=utf-8" }],
          cookies: [],
          body: {
            disposition: "captured",
            encoding: "utf8",
            value: JSON.stringify({ query: "query EdgeCase { viewer { id } }", variables: { unicode: "🙂", nullish: null } })
          }
        },
        status: 500,
        statusText: "Internal Server Error",
        response: {
          headers: [{ name: "content-type", value: "application/json" }],
          setCookieHeaders: ["id=abc; Secure; HttpOnly"],
          setCookies: [{ name: "id", value: "abc", raw: "id=abc; Secure; HttpOnly", secure: true, httpOnly: true }],
          body: {
            disposition: "captured",
            encoding: "utf8",
            value: "{\"error\":\"unexpected\"}"
          }
        },
        durationMs: 250,
        failureText: "ERR_HTTP2_PROTOCOL_ERROR"
      }
    },
    {
      at: "2024-06-01T12:01:01.000Z",
      payload: {
        kind: "network",
        method: "GET",
        url: "https://cdn.example.com/app.js",
        subtype: "script",
        request: {
          headers: [{ name: "accept", value: "*/*" }],
          cookies: []
        },
        status: 200,
        statusText: "OK",
        response: {
          headers: [{ name: "content-encoding", value: "gzip" }],
          setCookieHeaders: [],
          setCookies: [],
          body: {
            disposition: "truncated",
            reason: "size_limit"
          }
        },
        durationMs: 15
      }
    },
    {
      at: "2024-06-01T12:01:02.000Z",
      payload: {
        kind: "network",
        method: "GET",
        url: "https://example.com/api/timeout",
        subtype: "xhr",
        request: {
          headers: [{ name: "x-request-id", value: "req-timeout" }],
          cookies: []
        },
        response: {
          headers: [],
          setCookieHeaders: [],
          setCookies: []
        },
        failureText: "net::ERR_TIMED_OUT"
      }
    }
  ];
}

function createCanonicalArchive(actionCount: number): SessionArchive {
  const draft = createSessionDraft({
    page: {
      title: "Canonical Fixture",
      url: "https://example.com"
    },
    now: new Date(CANONICAL_NOW)
  });

  const events: SessionEvent[] = [
    {
      at: CANONICAL_NOW,
      payload: { kind: "lifecycle", phase: "recording", detail: "Fixture start" }
    },
    ...makeActionEvents(actionCount),
    ...networkEdgeCaseEvents()
  ];
  const updatedAt = events.reduce((latest, event) => (event.at > latest ? event.at : latest), CANONICAL_NOW);

  const archive = createSessionArchive({
    ...draft,
    createdAt: CANONICAL_NOW,
    updatedAt,
    phase: "ready",
    events
  });

  const actionIds = archive.sections.actions
    .filter((entry) => entry.payload.kind === "interaction")
    .slice(0, 3)
    .map((entry) => entry.id);

  return sessionArchiveSchema.parse({
    ...archive,
    annotations: actionIds.length >= 2
      ? [
          {
            id: "merge-canonical-001",
            kind: "merge-group",
            memberIds: actionIds,
            tags: ["canonical", "fixture"],
            label: "Canonical merge group",
            createdAt: CANONICAL_NOW
          }
        ]
      : []
  });
}

export const canonicalArchiveBundles = {
  small: createCanonicalArchive(3),
  medium: createCanonicalArchive(20),
  large: createCanonicalArchive(200)
} as const;

export function createFixtureZip(archive: SessionArchive, files?: Zippable): Uint8Array {
  return zipSync({
    "session.archive.json": strToU8(JSON.stringify(archive)),
    "recording.webm": ZIP_RECORDING_BYTES,
    ...files
  });
}

export const canonicalZipBundles = {
  small: createFixtureZip(canonicalArchiveBundles.small),
  medium: createFixtureZip(canonicalArchiveBundles.medium),
  large: createFixtureZip(canonicalArchiveBundles.large)
} as const;

export const canonicalCorruptedZipBundles = {
  missingArchive: zipSync({ "recording.webm": ZIP_RECORDING_BYTES }),
  missingRecording: zipSync({ "session.archive.json": strToU8(JSON.stringify(canonicalArchiveBundles.small)) }),
  invalidArchiveJson: zipSync({
    "session.archive.json": strToU8("{ broken json"),
    "recording.webm": ZIP_RECORDING_BYTES
  }),
  schemaInvalidArchive: zipSync({
    "session.archive.json": strToU8(JSON.stringify({ schemaVersion: 99, bad: true })),
    "recording.webm": ZIP_RECORDING_BYTES
  })
} as const;

export const canonicalRecordingBytes = ZIP_RECORDING_BYTES;
