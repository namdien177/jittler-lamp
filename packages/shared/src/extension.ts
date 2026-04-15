import { z } from "zod";

import {
  captureSessionDraftSchema,
  interactionEventSchema,
  pageContextSchema,
  sessionBundleSchema,
  sessionIdSchema
} from "./session";

export const popupGetStateRequestSchema = z.object({
  type: z.literal("jl/popup-get-state")
});

export const popupStartRecordingRequestSchema = z.object({
  type: z.literal("jl/popup-start-recording")
});

export const popupStopRecordingRequestSchema = z.object({
  type: z.literal("jl/popup-stop-recording")
});

export const popupRequestSchema = z.discriminatedUnion("type", [
  popupGetStateRequestSchema,
  popupStartRecordingRequestSchema,
  popupStopRecordingRequestSchema
]);

export const popupSessionSummarySchema = captureSessionDraftSchema
  .pick({
    sessionId: true,
    name: true,
    phase: true,
    createdAt: true,
    updatedAt: true,
    page: true,
    artifacts: true
  })
  .extend({
    eventCount: z.number().int().nonnegative()
  });

export const popupStateSchema = z.object({
  activeSession: popupSessionSummarySchema.nullable(),
  canStart: z.boolean(),
  canStop: z.boolean()
});

export const popupResponseSchema = z.object({
  ok: z.boolean(),
  state: popupStateSchema,
  error: z.string().min(1).optional()
});

export const contentBeginCaptureMessageSchema = z.object({
  type: z.literal("jl/content-begin-capture"),
  sessionId: sessionIdSchema
});

export const contentEndCaptureMessageSchema = z.object({
  type: z.literal("jl/content-end-capture"),
  sessionId: sessionIdSchema
});

export const backgroundToContentMessageSchema = z.discriminatedUnion("type", [
  contentBeginCaptureMessageSchema,
  contentEndCaptureMessageSchema
]);

export const contentReadyMessageSchema = z.object({
  type: z.literal("jl/content-ready"),
  sessionId: sessionIdSchema,
  page: pageContextSchema.omit({ tabId: true })
});

export const interactionMessageSchema = z.object({
  type: z.literal("jl/interaction"),
  sessionId: sessionIdSchema,
  payload: interactionEventSchema
});

export const contentRuntimeMessageSchema = z.discriminatedUnion("type", [
  contentReadyMessageSchema,
  interactionMessageSchema
]);

export const offscreenStartRecordingRequestSchema = z.object({
  type: z.literal("jl/offscreen-start-recording"),
  sessionId: sessionIdSchema,
  tabId: z.number().int().nonnegative(),
  streamId: z.string().min(1)
});

export const offscreenStopAndExportRequestSchema = z.object({
  type: z.literal("jl/offscreen-stop-and-export"),
  sessionId: sessionIdSchema,
  bundle: sessionBundleSchema
});

export const offscreenRequestSchema = z.discriminatedUnion("type", [
  offscreenStartRecordingRequestSchema,
  offscreenStopAndExportRequestSchema
]);

export const offscreenResponseSchema = z.object({
  ok: z.boolean(),
  recordingBytes: z.number().int().nonnegative().optional(),
  eventBytes: z.number().int().nonnegative().optional(),
  error: z.string().min(1).optional()
});

export type PopupRequest = z.infer<typeof popupRequestSchema>;
export type PopupResponse = z.infer<typeof popupResponseSchema>;
export type PopupSessionSummary = z.infer<typeof popupSessionSummarySchema>;
export type PopupState = z.infer<typeof popupStateSchema>;
export type BackgroundToContentMessage = z.infer<typeof backgroundToContentMessageSchema>;
export type ContentRuntimeMessage = z.infer<typeof contentRuntimeMessageSchema>;
export type OffscreenRequest = z.infer<typeof offscreenRequestSchema>;
export type OffscreenResponse = z.infer<typeof offscreenResponseSchema>;
