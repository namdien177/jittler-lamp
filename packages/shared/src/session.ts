import { z } from "zod";

export const sessionSchemaVersion = 2;

export const isoTimestampSchema = z.string().datetime({ offset: true });
export const sessionIdSchema = z.string().min(8).max(128);
export const nonEmptyPathSchema = z.string().min(1);

export const capturePhaseSchema = z.enum([
  "idle",
  "armed",
  "recording",
  "processing",
  "ready",
  "failed"
]);

export const artifactKindSchema = z.enum([
  "recording.webm",
  "session.events.json"
]);

export const sessionArtifactSchema = z.object({
  kind: artifactKindSchema,
  relativePath: nonEmptyPathSchema,
  mimeType: z.string().min(1),
  bytes: z.number().int().nonnegative().optional()
});

export const pageContextSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  tabId: z.number().int().nonnegative().optional()
});

export const consoleEventSchema = z.object({
  kind: z.literal("console"),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  args: z.array(z.string()).default([])
});

export const networkHeaderSchema = z.object({
  name: z.string().min(1),
  value: z.string()
});

export const networkCookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  expires: z.number().finite().optional(),
  size: z.number().int().nonnegative().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  session: z.boolean().optional(),
  sameSite: z.string().min(1).optional(),
  priority: z.string().min(1).optional(),
  sameParty: z.boolean().optional(),
  sourcePort: z.number().int().optional(),
  sourceScheme: z.string().min(1).optional(),
  partitionKey: z.string().min(1).optional(),
  partitioned: z.boolean().optional()
});

export const networkAssociatedCookieSchema = z.object({
  cookie: networkCookieSchema,
  blockedReasons: z.array(z.string().min(1)).default([])
});

export const networkSetCookieSchema = networkCookieSchema.extend({
  raw: z.string().min(1)
});

export const networkBodyCaptureSchema = z.object({
  disposition: z.enum(["captured", "truncated", "omitted", "unavailable"]),
  encoding: z.enum(["utf8", "base64"]).optional(),
  mimeType: z.string().min(1).optional(),
  value: z.string().optional(),
  byteLength: z.number().int().nonnegative().optional(),
  omittedByteLength: z.number().int().nonnegative().optional(),
  reason: z.string().min(1).optional()
});

export const networkEventSchema = z.object({
  kind: z.literal("network"),
  method: z.string().min(1),
  url: z.string().url(),
  status: z.number().int().min(100).max(599).optional(),
  statusText: z.string().min(1).optional(),
  durationMs: z.number().nonnegative().optional(),
  requestId: z.string().min(1).optional(),
  request: z.object({
    headers: z.array(networkHeaderSchema).default([]),
    cookies: z.array(networkAssociatedCookieSchema).default([]),
    body: networkBodyCaptureSchema.optional()
  }),
  response: z
    .object({
      headers: z.array(networkHeaderSchema).default([]),
      setCookieHeaders: z.array(z.string().min(1)).default([]),
      setCookies: z.array(networkSetCookieSchema).default([]),
      body: networkBodyCaptureSchema.optional()
    })
    .optional(),
  failureText: z.string().min(1).optional()
});

export const interactionEventSchema = z.object({
  kind: z.literal("interaction"),
  type: z.enum(["click", "input", "submit", "navigation"]),
  selector: z.string().min(1).optional(),
  valuePreview: z.string().max(240).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional()
});

export const errorEventSchema = z.object({
  kind: z.literal("error"),
  message: z.string().min(1),
  stack: z.string().optional(),
  source: z.enum(["page", "extension", "runtime"])
});

export const lifecycleEventSchema = z.object({
  kind: z.literal("lifecycle"),
  phase: capturePhaseSchema,
  detail: z.string().min(1)
});

export const sessionEventPayloadSchema = z.discriminatedUnion("kind", [
  consoleEventSchema,
  networkEventSchema,
  interactionEventSchema,
  errorEventSchema,
  lifecycleEventSchema
]);

export const sessionEventSchema = z.object({
  at: isoTimestampSchema,
  payload: sessionEventPayloadSchema
});

export const sessionBundleSchema = z.object({
  schemaVersion: z.literal(sessionSchemaVersion),
  sessionId: sessionIdSchema,
  name: z.string().min(1),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  phase: capturePhaseSchema,
  page: pageContextSchema,
  artifacts: z.array(sessionArtifactSchema),
  events: z.array(sessionEventSchema),
  notes: z.array(z.string()).default([])
});

export const captureSessionDraftSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1),
  phase: capturePhaseSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  page: pageContextSchema,
  artifacts: z.array(sessionArtifactSchema),
  events: z.array(sessionEventSchema),
  notes: z.array(z.string()).default([])
});

export type CapturePhase = z.infer<typeof capturePhaseSchema>;
export type SessionArtifact = z.infer<typeof sessionArtifactSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type SessionBundle = z.infer<typeof sessionBundleSchema>;
export type CaptureSessionDraft = z.infer<typeof captureSessionDraftSchema>;

export function sanitizeCapturedUrl(input: string): string {
  try {
    const url = new URL(input);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return input;
  }
}

export function createSessionName(input: { title: string; url: string }): string {
  const title = input.title.trim();

  if (title.length > 0) {
    return title;
  }

  const hostnameMatch = sanitizeCapturedUrl(input.url).match(/^[a-z]+:\/\/([^/]+)/i);

  if (hostnameMatch?.[1]) {
    return hostnameMatch[1];
  }

  return "Untitled session";
}

export function createSessionId(now: Date = new Date()): string {
  return `jl_${now.getTime().toString(36)}`;
}

export function createSessionArtifacts(sessionId: string): SessionArtifact[] {
  return [
    {
      kind: "recording.webm",
      relativePath: `${sessionId}/recording.webm`,
      mimeType: "video/webm"
    },
    {
      kind: "session.events.json",
      relativePath: `${sessionId}/session.events.json`,
      mimeType: "application/json"
    }
  ];
}

export function createSessionDraft(input: {
  page: { tabId?: number; title: string; url: string };
  now?: Date;
}): CaptureSessionDraft {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const sessionId = createSessionId(now);
  const sanitizedUrl = sanitizeCapturedUrl(input.page.url);

  return {
    sessionId,
    name: createSessionName({
      title: input.page.title,
      url: sanitizedUrl
    }),
    phase: "armed",
    createdAt: timestamp,
    updatedAt: timestamp,
    page: {
      tabId: input.page.tabId,
      title: input.page.title,
      url: sanitizedUrl
    },
    artifacts: createSessionArtifacts(sessionId),
    events: [
      {
        at: timestamp,
        payload: {
          kind: "lifecycle",
          phase: "armed",
          detail: "Session scaffold created from active tab."
        }
      }
    ],
    notes: []
  };
}

export function appendDraftEvent(
  draft: CaptureSessionDraft,
  payload: z.input<typeof sessionEventPayloadSchema>,
  now: Date = new Date()
): CaptureSessionDraft {
  const timestamp = now.toISOString();

  return {
    ...draft,
    updatedAt: timestamp,
    events: [
      ...draft.events,
      {
        at: timestamp,
        payload: sessionEventPayloadSchema.parse(payload)
      }
    ]
  };
}

export function updateDraftPage(
  draft: CaptureSessionDraft,
  page: { tabId?: number; title: string; url: string },
  now: Date = new Date()
): CaptureSessionDraft {
  const sanitizedUrl = sanitizeCapturedUrl(page.url);

  return {
    ...draft,
    name: createSessionName({
      title: page.title,
      url: sanitizedUrl
    }),
    updatedAt: now.toISOString(),
    page: {
      tabId: page.tabId,
      title: page.title,
      url: sanitizedUrl
    }
  };
}

export function transitionDraftPhase(
  draft: CaptureSessionDraft,
  phase: CapturePhase,
  detail: string,
  now: Date = new Date()
): CaptureSessionDraft {
  return appendDraftEvent(
    {
      ...draft,
      phase,
      updatedAt: now.toISOString()
    },
    {
      kind: "lifecycle",
      phase,
      detail
    },
    now
  );
}

export function createSessionBundle(draft: CaptureSessionDraft): SessionBundle {
  return sessionBundleSchema.parse({
    schemaVersion: sessionSchemaVersion,
    sessionId: draft.sessionId,
    name: draft.name,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    phase: draft.phase,
    page: draft.page,
    artifacts: draft.artifacts,
    events: draft.events,
    notes: draft.notes
  });
}
