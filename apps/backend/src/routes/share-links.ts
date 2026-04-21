import { and, eq, gt, isNull } from "drizzle-orm";
import { Elysia, t } from "elysia";

import {
	evidences,
	organizationMembers,
	shareLinks,
	users,
} from "../db/schema";
import { authContext } from "../middleware/auth-context";

import type { BackendDb } from "../services/user-provisioning";

const createShareLinkBodySchema = t.Object({
	expiresInMs: t.Optional(
		t.Number({
			minimum: 60_000,
			maximum: 1000 * 60 * 60 * 24 * 365,
		}),
	),
});

const hashToken = async (token: string): Promise<string> => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return Array.from(new Uint8Array(digest))
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
};

const resolveLocalUserId = async (db: BackendDb, clerkUserId: string) => {
	const user = await db.query.users.findFirst({
		where: eq(users.clerkUserId, clerkUserId),
		columns: { id: true },
	});
	return user?.id ?? null;
};

const checkOrgMembership = async (
	db: BackendDb,
	orgId: string,
	userId: string,
) => {
	const membership = await db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.organizationId, orgId),
			eq(organizationMembers.userId, userId),
		),
		columns: { id: true },
	});
	return Boolean(membership);
};

const createForbiddenPayload = (requestId?: string) => ({
	error: {
		code: "SHARE_LINK_FORBIDDEN",
		message: "You do not have access to this evidence share link",
		status: 403,
		requestId: requestId ?? null,
	},
});

export const shareLinkRoutes = new Elysia({ name: "share-link-routes" })
	.use(authContext)
	.post(
		"/evidences/:id/share-links",
		async (ctx) => {
			const { authContext, body, params, set, store } = ctx;
			const requestId = (ctx as { requestId?: string }).requestId;
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

			const localUserId = await resolveLocalUserId(db, authContext.userId);
			if (!localUserId) {
				set.status = 403;
				return createForbiddenPayload(requestId);
			}

			const evidence = await db.query.evidences.findFirst({
				where: eq(evidences.id, params.id),
				columns: { id: true, orgId: true },
			});
			if (!evidence) {
				set.status = 404;
				return {
					error: {
						code: "EVIDENCE_NOT_FOUND",
						message: "Evidence not found",
						status: 404,
						requestId: requestId ?? null,
					},
				};
			}

			const canAccess = await checkOrgMembership(
				db,
				evidence.orgId,
				localUserId,
			);
			if (!canAccess) {
				set.status = 403;
				return createForbiddenPayload(requestId);
			}

			const rawToken = crypto.randomUUID();
			const now = Date.now();
			const expiresAt = now + (body.expiresInMs ?? 1000 * 60 * 60 * 24);
			const tokenHash = await hashToken(rawToken);

			const [inserted] = await db
				.insert(shareLinks)
				.values({
					tokenHash,
					evidenceId: evidence.id,
					orgId: evidence.orgId,
					scopeType: "organization",
					scopeId: evidence.orgId,
					expiresAt,
					createdBy: localUserId,
					updatedAt: now,
				})
				.returning({
					id: shareLinks.id,
					evidenceId: shareLinks.evidenceId,
					orgId: shareLinks.orgId,
					expiresAt: shareLinks.expiresAt,
				});

			if (!inserted) {
				set.status = 500;
				return {
					error: {
						code: "SHARE_LINK_CREATE_FAILED",
						message: "Failed to create share link",
						status: 500,
						requestId: requestId ?? null,
					},
				};
			}

			return {
				shareLink: {
					id: inserted.id,
					token: rawToken,
					evidenceId: inserted.evidenceId,
					orgId: inserted.orgId,
					expiresAt: inserted.expiresAt,
					scope: "internal",
				},
			};
		},
		{
			body: createShareLinkBodySchema,
			detail: {
				tags: ["evidences"],
				summary: "Creates an internal organization-scoped share link",
			},
		},
	)
	.get(
		"/share-links/:token/resolve",
		async (ctx) => {
			const { authContext, params, set, store } = ctx;
			const requestId = (ctx as { requestId?: string }).requestId;
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

			const tokenHash = await hashToken(params.token);
			const shareLink = await db.query.shareLinks.findFirst({
				where: and(
					eq(shareLinks.tokenHash, tokenHash),
					gt(shareLinks.expiresAt, Date.now()),
					isNull(shareLinks.revokedAt),
				),
				columns: {
					id: true,
					evidenceId: true,
					orgId: true,
					expiresAt: true,
					revokedAt: true,
				},
			});

			if (!shareLink) {
				set.status = 404;
				return {
					error: {
						code: "SHARE_LINK_NOT_FOUND",
						message: "Share link is invalid, expired, or revoked",
						status: 404,
						requestId: requestId ?? null,
					},
				};
			}

			const localUserId = await resolveLocalUserId(db, authContext.userId);
			if (!localUserId) {
				set.status = 403;
				return createForbiddenPayload(requestId);
			}

			const canAccess = await checkOrgMembership(
				db,
				shareLink.orgId,
				localUserId,
			);
			if (!canAccess) {
				set.status = 403;
				return createForbiddenPayload(requestId);
			}

			return {
				shareLink: {
					id: shareLink.id,
					evidenceId: shareLink.evidenceId,
					orgId: shareLink.orgId,
					expiresAt: shareLink.expiresAt,
				},
			};
		},
		{
			detail: {
				tags: ["evidences"],
				summary: "Resolves internal share links for authenticated org members",
			},
		},
	)
	.post(
		"/share-links/:id/revoke",
		async (ctx) => {
			const { authContext, params, set, store } = ctx;
			const requestId = (ctx as { requestId?: string }).requestId;
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

			const shareLink = await db.query.shareLinks.findFirst({
				where: eq(shareLinks.id, params.id),
				columns: { id: true, orgId: true, revokedAt: true },
			});
			if (!shareLink) {
				set.status = 404;
				return {
					error: {
						code: "SHARE_LINK_NOT_FOUND",
						message: "Share link not found",
						status: 404,
						requestId: requestId ?? null,
					},
				};
			}

			const localUserId = await resolveLocalUserId(db, authContext.userId);
			if (!localUserId) {
				set.status = 403;
				return createForbiddenPayload(requestId);
			}

			const canAccess = await checkOrgMembership(
				db,
				shareLink.orgId,
				localUserId,
			);
			if (!canAccess) {
				set.status = 403;
				return createForbiddenPayload(requestId);
			}

			if (shareLink.revokedAt !== null) {
				return {
					shareLink: {
						id: shareLink.id,
						revokedAt: shareLink.revokedAt,
					},
				};
			}

			const revokedAt = Date.now();
			const [updated] = await db
				.update(shareLinks)
				.set({ revokedAt, updatedAt: revokedAt })
				.where(eq(shareLinks.id, params.id))
				.returning({ id: shareLinks.id, revokedAt: shareLinks.revokedAt });

			if (!updated) {
				set.status = 500;
				return {
					error: {
						code: "SHARE_LINK_REVOKE_FAILED",
						message: "Failed to revoke share link",
						status: 500,
						requestId: requestId ?? null,
					},
				};
			}

			return {
				shareLink: {
					id: updated.id,
					revokedAt: updated.revokedAt,
				},
			};
		},
		{
			detail: {
				tags: ["evidences"],
				summary: "Revokes an internal share link",
			},
		},
	);
