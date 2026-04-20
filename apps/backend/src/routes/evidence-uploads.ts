import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import {
	evidenceArtifactKindSchema,
	evidenceArtifacts,
	evidences,
} from "../db/schema";
import { authContext } from "../middleware/auth-context";
import { resolveActiveOrganizationForClerkUser } from "../services/active-organization";
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

type UploadedBlobMetadata = {
	bytes: number;
	checksum: string;
	mimeType: string;
};

const uploadedBlobStore = new Map<string, UploadedBlobMetadata>();

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

export const evidenceUploadRoutes = new Elysia({
	name: "evidence-upload-routes",
})
	.use(authContext)
	.post(
		"/evidences/uploads/start",
		async (ctx) => {
			const { authContext, body, set, request, store } = ctx;
			const requestId = (ctx as { requestId?: string }).requestId;
			if (body.orgId) {
				set.status = 400;
				return {
					error: {
						code: "EVIDENCE_UPLOAD_CLIENT_ORG_FORBIDDEN",
						message: "Client-provided orgId is not allowed",
						status: 400,
						requestId: requestId ?? null,
					},
				};
			}

			if (!authContext.userId) {
				set.status = 401;
				return {
					error: {
						code: "AUTH_UNAUTHENTICATED",
						message: "Authentication required",
						status: 401,
						requestId: requestId ?? null,
					},
				};
			}

			const db = (store as { db?: BackendDb }).db;
			if (!db) {
				set.status = 500;
				return {
					error: {
						code: "DB_UNAVAILABLE",
						message: "Database is unavailable",
						status: 500,
						requestId: requestId ?? null,
					},
				};
			}

			const resolved = await resolveActiveOrganizationForClerkUser(
				db,
				authContext.userId,
				authContext.orgId,
			);
			if (!resolved) {
				set.status = 403;
				return {
					error: {
						code: "ORG_CONTEXT_UNRESOLVED",
						message: "No active organization found for current user",
						status: 403,
						requestId: requestId ?? null,
					},
				};
			}

			const now = Date.now();
			const created = await db.transaction(async (tx) => {
				const [evidence] = await tx
					.insert(evidences)
					.values({
						orgId: resolved.organizationId,
						createdBy: resolved.localUserId,
						title: body.title,
						sourceType: body.sourceType,
						sourceUri: body.sourceUri,
						sourceExternalId: body.sourceExternalId,
						sourceMetadata: body.sourceMetadata,
						thumbnailBase64: body.thumbnailBase64,
						thumbnailMimeType: body.thumbnailMimeType,
						scopeType: "organization",
						scopeId: resolved.organizationId,
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
						s3Key: `uploads/${resolved.organizationId}/${evidence.id}/${crypto.randomUUID()}`,
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
					expiresAt: now + 5 * 60 * 1000,
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
		},
	)
	.put(
		"/evidences/uploads/:uploadId/blob",
		async (ctx) => {
			const { authContext, params, request, set, store } = ctx;
			const requestId = (ctx as { requestId?: string }).requestId;
			if (!authContext.userId) {
				set.status = 401;
				return {
					error: {
						code: "AUTH_UNAUTHENTICATED",
						message: "Authentication required",
						status: 401,
						requestId: requestId ?? null,
					},
				};
			}

			const db = (store as { db?: BackendDb }).db;
			if (!db) {
				set.status = 500;
				return {
					error: {
						code: "DB_UNAVAILABLE",
						message: "Database is unavailable",
						status: 500,
						requestId: requestId ?? null,
					},
				};
			}

			const resolved = await resolveActiveOrganizationForClerkUser(
				db,
				authContext.userId,
				authContext.orgId,
			);
			if (!resolved) {
				set.status = 403;
				return {
					error: {
						code: "ORG_CONTEXT_UNRESOLVED",
						message: "No active organization found for current user",
						status: 403,
						requestId: requestId ?? null,
					},
				};
			}

			const artifact = await db.query.evidenceArtifacts.findFirst({
				where: eq(evidenceArtifacts.id, params.uploadId),
				columns: {
					id: true,
					mimeType: true,
				},
				with: {
					evidence: {
						columns: { orgId: true },
					},
				},
			});

			if (!artifact || artifact.evidence.orgId !== resolved.organizationId) {
				set.status = 404;
				return {
					error: {
						code: "UPLOAD_NOT_FOUND",
						message: "Upload not found for active organization",
						status: 404,
						requestId: requestId ?? null,
					},
				};
			}

			const contentType = request.headers.get("content-type");
			if (!contentType || contentType !== artifact.mimeType) {
				set.status = 422;
				return {
					error: {
						code: "UPLOAD_CONTENT_TYPE_MISMATCH",
						message:
							"Uploaded blob content-type did not match expected mimeType",
						status: 422,
						requestId: requestId ?? null,
					},
				};
			}

			const payload = await request.arrayBuffer();
			const bytes = payload.byteLength;
			const checksum = await encodeSha256(payload);
			uploadedBlobStore.set(artifact.id, {
				bytes,
				checksum,
				mimeType: artifact.mimeType,
			});

			set.status = 204;
			return;
		},
		{
			params: t.Object({ uploadId: t.String() }),
			detail: {
				tags: ["evidences"],
				summary: "Accepts upload binary for a server-scoped evidence upload",
			},
		},
	)
	.post(
		"/evidences/uploads/:uploadId/complete",
		async (ctx) => {
			const { authContext, params, body, set, store } = ctx;
			const requestId = (ctx as { requestId?: string }).requestId;
			if (!authContext.userId) {
				set.status = 401;
				return {
					error: {
						code: "AUTH_UNAUTHENTICATED",
						message: "Authentication required",
						status: 401,
						requestId: requestId ?? null,
					},
				};
			}

			const db = (store as { db?: BackendDb }).db;
			if (!db) {
				set.status = 500;
				return {
					error: {
						code: "DB_UNAVAILABLE",
						message: "Database is unavailable",
						status: 500,
						requestId: requestId ?? null,
					},
				};
			}

			const resolved = await resolveActiveOrganizationForClerkUser(
				db,
				authContext.userId,
				authContext.orgId,
			);
			if (!resolved) {
				set.status = 403;
				return {
					error: {
						code: "ORG_CONTEXT_UNRESOLVED",
						message: "No active organization found for current user",
						status: 403,
						requestId: requestId ?? null,
					},
				};
			}

			const artifact = await db.query.evidenceArtifacts.findFirst({
				where: eq(evidenceArtifacts.id, params.uploadId),
				columns: {
					id: true,
					evidenceId: true,
					bytes: true,
					checksum: true,
					mimeType: true,
				},
				with: {
					evidence: {
						columns: { id: true, orgId: true },
					},
				},
			});

			if (!artifact || artifact.evidence.orgId !== resolved.organizationId) {
				set.status = 404;
				return {
					error: {
						code: "UPLOAD_NOT_FOUND",
						message: "Upload not found for active organization",
						status: 404,
						requestId: requestId ?? null,
					},
				};
			}

			if (
				artifact.bytes !== Math.trunc(body.bytes) ||
				artifact.checksum !== body.checksum ||
				artifact.mimeType !== body.mimeType
			) {
				set.status = 422;
				return {
					error: {
						code: "UPLOAD_METADATA_MISMATCH",
						message:
							"Uploaded artifact metadata did not match expected draft metadata",
						status: 422,
						requestId: requestId ?? null,
					},
				};
			}

			const uploadedBlob = uploadedBlobStore.get(artifact.id);
			if (!uploadedBlob) {
				set.status = 409;
				return {
					error: {
						code: "UPLOAD_BLOB_MISSING",
						message:
							"Upload blob was not found; upload binary before completing",
						status: 409,
						requestId: requestId ?? null,
					},
				};
			}

			if (
				uploadedBlob.bytes !== Math.trunc(body.bytes) ||
				uploadedBlob.mimeType !== body.mimeType ||
				!checksumMatches(body.checksum, uploadedBlob.checksum)
			) {
				set.status = 422;
				return {
					error: {
						code: "UPLOAD_BLOB_METADATA_MISMATCH",
						message: "Uploaded blob did not match completion metadata",
						status: 422,
						requestId: requestId ?? null,
					},
				};
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
							eq(evidences.orgId, resolved.organizationId),
						),
					);
			});
			uploadedBlobStore.delete(artifact.id);

			return {
				uploadId: artifact.id,
				evidenceId: artifact.evidenceId,
				status: "committed",
			};
		},
		{
			params: t.Object({ uploadId: t.String() }),
			body: completeUploadBodySchema,
			detail: {
				tags: ["evidences"],
				summary: "Completes a server-scoped evidence upload",
			},
		},
	);
