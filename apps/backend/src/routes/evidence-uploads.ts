import { and, desc, eq, isNull } from "drizzle-orm";
import { Elysia, t } from "elysia";

import {
	evidenceArtifactKindSchema,
	evidenceArtifacts,
	evidences,
	organizationMembers,
} from "../db/schema";
import {
	apiErrorSchema,
	createApiError,
	createDbUnavailableError,
} from "../http/api-error";
import type { ClerkAuthPlugin } from "../plugins/clerk-auth";
import type { BackendDb } from "../services/user-provisioning";

const startUploadBodySchema = t.Object({
	title: t.String({ minLength: 1 }),
	sourceType: t.String({ minLength: 1 }),
	sourceUri: t.Optional(t.String({ format: "uri" })),
	sourceExternalId: t.Optional(t.String({ minLength: 1 })),
	sourceMetadata: t.Optional(t.String()),
	thumbnailBase64: t.Optional(t.String({ maxLength: 20_000 })),
	thumbnailMimeType: t.Optional(t.String({ minLength: 1 })),
	artifact: t.Object({
		kind: t.Union(
			evidenceArtifactKindSchema.options.map((value) => t.Literal(value)),
		),
		mimeType: t.String({ minLength: 1 }),
		bytes: t.Number({ minimum: 0 }),
		checksum: t.String({ minLength: 1 }),
	}),
	orgId: t.Optional(t.String()),
});

const completeUploadBodySchema = t.Object({
	bytes: t.Number({ minimum: 0 }),
	checksum: t.String({ minLength: 1 }),
	mimeType: t.String({ minLength: 1 }),
});

const uploadParamsSchema = t.Object({
	uploadId: t.String({ minLength: 1 }),
});

const startUploadResponseSchema = t.Object({
	uploadId: t.String({ minLength: 1 }),
	evidenceId: t.String({ minLength: 1 }),
	organizationId: t.String({ minLength: 1 }),
	uploadSession: t.Object({
		expiresAt: t.Number(),
		uploadUrl: t.String({ format: "uri" }),
		method: t.Literal("PUT"),
		headers: t.Object({
			"content-type": t.String({ minLength: 1 }),
		}),
		storageKey: t.String({ minLength: 1 }),
	}),
});

const completeUploadResponseSchema = t.Object({
	uploadId: t.String({ minLength: 1 }),
	evidenceId: t.String({ minLength: 1 }),
	status: t.Literal("committed"),
});

const evidenceQuerySchema = t.Object({
	orgId: t.Optional(t.String({ minLength: 1 })),
});

const evidenceSummarySchema = t.Object({
	id: t.String({ minLength: 1 }),
	orgId: t.String({ minLength: 1 }),
	title: t.String({ minLength: 1 }),
	sourceType: t.String({ minLength: 1 }),
	createdBy: t.String({ minLength: 1 }),
	createdAt: t.Number(),
	updatedAt: t.Number(),
});

const listEvidencesResponseSchema = t.Object({
	evidences: t.Array(evidenceSummarySchema),
	orgId: t.String({ minLength: 1 }),
});

const loadEvidenceResponseSchema = t.Object({
	evidence: evidenceSummarySchema,
});

type UploadedBlobMetadata = {
	bytes: number;
	checksum: string;
	mimeType: string;
};

const UPLOAD_SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

const encodeSha256 = async (payload: ArrayBuffer): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", payload);
	return Array.from(new Uint8Array(digest))
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
};

const checksumMatches = (
	expected: string,
	actualSha256Hex: string,
): boolean => {
	const normalizedExpected = expected.toLowerCase();
	const normalizedActual = actualSha256Hex.toLowerCase();
	return (
		normalizedExpected === normalizedActual ||
		normalizedExpected === `sha256:${normalizedActual}`
	);
};

const resolveActiveWorkspace = (
	activeOrgId: string | null,
	localUserId: string | null,
) =>
	activeOrgId && localUserId
		? {
				activeOrgId,
				localUserId,
			}
		: null;

const resolveRequestedOrgId = async (args: {
	authContext: {
		activeOrgId: string | null;
		localUserId: string | null;
	};
	db: BackendDb;
	requestedOrgId: string | undefined;
	requestId: string;
	set: {
		status?: number | string;
	};
}): Promise<
	| {
			ok: true;
			orgId: string;
			localUserId: string;
	  }
	| { ok: false; error: ReturnType<typeof createApiError> }
> => {
	const workspace = resolveActiveWorkspace(
		args.authContext.activeOrgId,
		args.authContext.localUserId,
	);
	if (!workspace) {
		args.set.status = 403;
		return {
			ok: false,
			error: createApiError(
				args.requestId,
				"ORG_CONTEXT_UNRESOLVED",
				"No active organization found for current user",
				403,
			),
		};
	}

	const resolvedOrgId = args.requestedOrgId ?? workspace.activeOrgId;

	const membership = await args.db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.organizationId, resolvedOrgId),
			eq(organizationMembers.userId, workspace.localUserId),
			isNull(organizationMembers.teamId),
		),
		columns: { id: true },
	});
	if (!membership) {
		args.set.status = 403;
		return {
			ok: false,
			error: createApiError(
				args.requestId,
				"ORG_MEMBERSHIP_REQUIRED",
				"Selected organization must be a member organization",
				403,
			),
		};
	}

	return {
		ok: true,
		orgId: resolvedOrgId,
		localUserId: workspace.localUserId,
	};
};

export const createEvidenceUploadRoutes = (auth: ClerkAuthPlugin) =>
	new Elysia({
		name: "evidence-upload-routes",
	})
		.use(auth)
		.guard({ auth: true }, (app) =>
			app
				.post(
					"/evidences/uploads/start",
					async ({ authContext, body, db, request, requestId, set }) => {
						if (body.orgId) {
							set.status = 400;
							return createApiError(
								requestId,
								"EVIDENCE_UPLOAD_CLIENT_ORG_FORBIDDEN",
								"Client-provided orgId is not allowed",
								400,
							);
						}

						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						const workspace = resolveActiveWorkspace(
							authContext.activeOrgId,
							authContext.localUserId,
						);
						if (!workspace) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No active organization found for current user",
								403,
							);
						}

						const now = Date.now();
						const created = await db.transaction(async (tx) => {
							const [evidence] = await tx
								.insert(evidences)
								.values({
									orgId: workspace.activeOrgId,
									createdBy: workspace.localUserId,
									title: body.title,
									sourceType: body.sourceType,
									sourceUri: body.sourceUri,
									sourceExternalId: body.sourceExternalId,
									sourceMetadata: body.sourceMetadata,
									thumbnailBase64: body.thumbnailBase64,
									thumbnailMimeType: body.thumbnailMimeType,
									scopeType: "organization",
									scopeId: workspace.activeOrgId,
									updatedAt: now,
								})
								.returning({ id: evidences.id, orgId: evidences.orgId });

							if (!evidence) {
								throw new Error("Failed to create draft evidence");
							}

							const [artifact] = await tx
								.insert(evidenceArtifacts)
								.values({
									evidenceId: evidence.id,
									kind: body.artifact.kind,
									s3Key: `uploads/${workspace.activeOrgId}/${evidence.id}/${crypto.randomUUID()}`,
									mimeType: body.artifact.mimeType,
									bytes: Math.trunc(body.artifact.bytes),
									checksum: body.artifact.checksum,
									uploadStatus: "uploading",
									updatedAt: now,
								})
								.returning({
									id: evidenceArtifacts.id,
									s3Key: evidenceArtifacts.s3Key,
								});

							if (!artifact) {
								throw new Error("Failed to create upload artifact");
							}

							return {
								evidenceId: evidence.id,
								uploadId: artifact.id,
								organizationId: evidence.orgId,
								s3Key: artifact.s3Key,
							};
						});

						return {
							uploadId: created.uploadId,
							evidenceId: created.evidenceId,
							organizationId: created.organizationId,
							uploadSession: {
								expiresAt: now + UPLOAD_SESSION_TTL_MS,
								uploadUrl: `${new URL(request.url).origin}/evidences/uploads/${created.uploadId}/blob`,
								method: "PUT",
								headers: {
									"content-type": body.artifact.mimeType,
								},
								storageKey: created.s3Key,
							},
						};
					},
					{
						body: startUploadBodySchema,
						detail: {
							tags: ["evidences"],
							summary: "Starts a server-scoped evidence upload",
						},
						response: {
							200: startUploadResponseSchema,
							400: apiErrorSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.get(
					"/evidences",
					async ({ authContext, db, query, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						const resolvedOrg = await resolveRequestedOrgId({
							authContext,
							db,
							requestedOrgId: query.orgId,
							requestId,
							set,
						});
						if (!resolvedOrg.ok) {
							return resolvedOrg.error;
						}

						const rows = await db.query.evidences.findMany({
							where: eq(evidences.orgId, resolvedOrg.orgId),
							columns: {
								id: true,
								orgId: true,
								title: true,
								sourceType: true,
								createdBy: true,
								createdAt: true,
								updatedAt: true,
							},
							orderBy: desc(evidences.updatedAt),
						});

						return {
							evidences: rows,
							orgId: resolvedOrg.orgId,
						};
					},
					{
						query: evidenceQuerySchema,
						detail: {
							tags: ["evidences"],
							summary:
								"Lists evidence for active org by default; orgId query is allowed for member orgs",
						},
						response: {
							200: listEvidencesResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.get(
					"/evidences/:id",
					async ({ authContext, db, params, query, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						const resolvedOrg = await resolveRequestedOrgId({
							authContext,
							db,
							requestedOrgId: query.orgId,
							requestId,
							set,
						});
						if (!resolvedOrg.ok) {
							return resolvedOrg.error;
						}

						const evidence = await db.query.evidences.findFirst({
							where: and(
								eq(evidences.id, params.id),
								eq(evidences.orgId, resolvedOrg.orgId),
							),
							columns: {
								id: true,
								orgId: true,
								title: true,
								sourceType: true,
								createdBy: true,
								createdAt: true,
								updatedAt: true,
							},
						});
						if (!evidence) {
							set.status = 404;
							return createApiError(
								requestId,
								"EVIDENCE_NOT_FOUND",
								"Evidence not found",
								404,
							);
						}

						return { evidence };
					},
					{
						params: t.Object({
							id: t.String({ minLength: 1 }),
						}),
						query: evidenceQuerySchema,
						detail: {
							tags: ["evidences"],
							summary:
								"Loads evidence scoped to active org by default; orgId query is allowed for member orgs",
						},
						response: {
							200: loadEvidenceResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							404: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.put(
					"/evidences/uploads/:uploadId/blob",
					async ({ authContext, db, params, request, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						const workspace = resolveActiveWorkspace(
							authContext.activeOrgId,
							authContext.localUserId,
						);
						if (!workspace) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No active organization found for current user",
								403,
							);
						}

						const artifact = await db.query.evidenceArtifacts.findFirst({
							where: eq(evidenceArtifacts.id, params.uploadId),
							columns: {
								id: true,
								mimeType: true,
								uploadStatus: true,
								createdAt: true,
							},
							with: {
								evidence: {
									columns: { orgId: true },
								},
							},
						});

						if (
							!artifact ||
							artifact.evidence.orgId !== workspace.activeOrgId
						) {
							set.status = 404;
							return createApiError(
								requestId,
								"UPLOAD_NOT_FOUND",
								"Upload not found for active organization",
								404,
							);
						}

						if (Date.now() > artifact.createdAt + UPLOAD_SESSION_TTL_MS) {
							set.status = 410;
							return createApiError(
								requestId,
								"UPLOAD_SESSION_EXPIRED",
								"Upload session has expired; start a new upload",
								410,
							);
						}

						if (artifact.uploadStatus !== "uploading") {
							set.status = 409;
							return createApiError(
								requestId,
								"UPLOAD_NOT_ACCEPTING_BLOB",
								"Upload is not accepting blob writes in current state",
								409,
							);
						}

						const contentType = request.headers.get("content-type");
						if (!contentType || contentType !== artifact.mimeType) {
							set.status = 422;
							return createApiError(
								requestId,
								"UPLOAD_CONTENT_TYPE_MISMATCH",
								"Uploaded blob content-type did not match expected mimeType",
								422,
							);
						}

						const tooLargeResponse = createApiError(
							requestId,
							"UPLOAD_TOO_LARGE",
							`Upload exceeds maximum allowed size of ${MAX_UPLOAD_BYTES} bytes`,
							413,
						);

						const contentLengthHeader = request.headers.get("content-length");
						const contentLength = contentLengthHeader
							? Number.parseInt(contentLengthHeader, 10)
							: null;
						if (contentLength !== null && contentLength > MAX_UPLOAD_BYTES) {
							set.status = 413;
							return tooLargeResponse;
						}

						const payload = await request.arrayBuffer();
						if (payload.byteLength > MAX_UPLOAD_BYTES) {
							set.status = 413;
							return tooLargeResponse;
						}

						const uploadedBlob: UploadedBlobMetadata = {
							bytes: payload.byteLength,
							checksum: await encodeSha256(payload),
							mimeType: artifact.mimeType,
						};

						const updated = await db
							.update(evidenceArtifacts)
							.set({
								bytes: uploadedBlob.bytes,
								checksum: uploadedBlob.checksum,
								mimeType: uploadedBlob.mimeType,
								uploadStatus: "pending",
								updatedAt: Date.now(),
							})
							.where(
								and(
									eq(evidenceArtifacts.id, artifact.id),
									eq(evidenceArtifacts.uploadStatus, "uploading"),
								),
							)
							.returning({ id: evidenceArtifacts.id });

						if (!updated[0]) {
							set.status = 409;
							return createApiError(
								requestId,
								"UPLOAD_STATE_CONFLICT",
								"Upload state changed concurrently; check current status and retry",
								409,
							);
						}

						set.status = 204;
						return;
					},
					{
						params: uploadParamsSchema,
						detail: {
							tags: ["evidences"],
							summary:
								"Accepts upload binary for a server-scoped evidence upload",
						},
						response: {
							204: t.Void(),
							401: apiErrorSchema,
							403: apiErrorSchema,
							404: apiErrorSchema,
							409: apiErrorSchema,
							410: apiErrorSchema,
							413: apiErrorSchema,
							422: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.post(
					"/evidences/uploads/:uploadId/complete",
					async ({ authContext, body, db, params, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						const workspace = resolveActiveWorkspace(
							authContext.activeOrgId,
							authContext.localUserId,
						);
						if (!workspace) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No active organization found for current user",
								403,
							);
						}

						const artifact = await db.query.evidenceArtifacts.findFirst({
							where: eq(evidenceArtifacts.id, params.uploadId),
							columns: {
								id: true,
								evidenceId: true,
								bytes: true,
								checksum: true,
								mimeType: true,
								uploadStatus: true,
								createdAt: true,
							},
							with: {
								evidence: {
									columns: { id: true, orgId: true },
								},
							},
						});

						if (
							!artifact ||
							artifact.evidence.orgId !== workspace.activeOrgId
						) {
							set.status = 404;
							return createApiError(
								requestId,
								"UPLOAD_NOT_FOUND",
								"Upload not found for active organization",
								404,
							);
						}

						if (Date.now() > artifact.createdAt + UPLOAD_SESSION_TTL_MS) {
							set.status = 410;
							return createApiError(
								requestId,
								"UPLOAD_SESSION_EXPIRED",
								"Upload session has expired; start a new upload",
								410,
							);
						}

						if (artifact.uploadStatus === "uploading") {
							set.status = 409;
							return createApiError(
								requestId,
								"UPLOAD_BLOB_MISSING",
								"Upload blob was not found; upload binary before completing",
								409,
							);
						}

						if (artifact.uploadStatus !== "pending") {
							set.status = 409;
							return createApiError(
								requestId,
								"UPLOAD_NOT_COMPLETABLE",
								"Upload is not in a completable state",
								409,
							);
						}

						if (
							artifact.bytes !== Math.trunc(body.bytes) ||
							artifact.mimeType !== body.mimeType ||
							!checksumMatches(body.checksum, artifact.checksum)
						) {
							set.status = 422;
							return createApiError(
								requestId,
								"UPLOAD_BLOB_METADATA_MISMATCH",
								"Uploaded blob did not match completion metadata",
								422,
							);
						}

						const now = Date.now();
						await db.transaction(async (tx) => {
							await tx
								.update(evidenceArtifacts)
								.set({ uploadStatus: "uploaded", updatedAt: now })
								.where(eq(evidenceArtifacts.id, artifact.id));

							await tx
								.update(evidences)
								.set({ updatedAt: now })
								.where(
									and(
										eq(evidences.id, artifact.evidenceId),
										eq(evidences.orgId, workspace.activeOrgId),
									),
								);
						});

						return {
							uploadId: artifact.id,
							evidenceId: artifact.evidenceId,
							status: "committed",
						};
					},
					{
						params: uploadParamsSchema,
						body: completeUploadBodySchema,
						detail: {
							tags: ["evidences"],
							summary: "Completes a server-scoped evidence upload",
						},
						response: {
							200: completeUploadResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							404: apiErrorSchema,
							409: apiErrorSchema,
							410: apiErrorSchema,
							422: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				),
		);
