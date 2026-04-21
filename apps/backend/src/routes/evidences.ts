import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import {
	evidences,
	organizationMembers,
	organizations,
	shareLinks,
	users,
} from "../db/schema";
import { authContext } from "../middleware/auth-context";

import type { BackendDb } from "../services/user-provisioning";

const moveEvidenceBodySchema = t.Object({
	targetOrgId: t.String({ minLength: 1 }),
});

const resolveLocalUserId = async (db: BackendDb, clerkUserId: string) => {
	const user = await db.query.users.findFirst({
		where: eq(users.clerkUserId, clerkUserId),
		columns: { id: true },
	});
	return user?.id ?? null;
};

export const evidenceRoutes = new Elysia({ name: "evidence-routes" })
	.use(authContext)
	.post(
		"/evidences/:id/move",
		async (ctx) => {
			const { authContext, body, params, set, store } = ctx;
			const requestId = (ctx as { requestId?: string }).requestId;
			const requestLogger = (
				ctx as {
					logger?: {
						info: (obj: Record<string, unknown>, message: string) => void;
					};
				}
			).logger;
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
				return {
					error: {
						code: "EVIDENCE_MOVE_FORBIDDEN",
						message: "Only permitted creators can move this evidence",
						status: 403,
						requestId: requestId ?? null,
					},
				};
			}

			const evidence = await db.query.evidences.findFirst({
				where: eq(evidences.id, params.id),
				columns: {
					id: true,
					orgId: true,
					createdBy: true,
					scopeType: true,
					scopeId: true,
				},
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

			if (evidence.orgId === body.targetOrgId) {
				set.status = 409;
				return {
					error: {
						code: "EVIDENCE_MOVE_SAME_ORG",
						message: "Evidence is already in the target organization",
						status: 409,
						requestId: requestId ?? null,
					},
				};
			}

			const [sourceMembership, targetMembership, sourceOrg] = await Promise.all(
				[
					db.query.organizationMembers.findFirst({
						where: and(
							eq(organizationMembers.organizationId, evidence.orgId),
							eq(organizationMembers.userId, localUserId),
						),
						columns: { role: true },
					}),
					db.query.organizationMembers.findFirst({
						where: and(
							eq(organizationMembers.organizationId, body.targetOrgId),
							eq(organizationMembers.userId, localUserId),
						),
						columns: { role: true },
					}),
					db.query.organizations.findFirst({
						where: eq(organizations.id, evidence.orgId),
						columns: { personalOwnerUserId: true },
					}),
				],
			);

			if (!targetMembership) {
				set.status = 403;
				return {
					error: {
						code: "EVIDENCE_MOVE_TARGET_MEMBERSHIP_REQUIRED",
						message:
							"You must be a member of both source and target organizations",
						status: 403,
						requestId: requestId ?? null,
					},
				};
			}

			const isEvidenceCreator = evidence.createdBy === localUserId;
			const isSourceOrgCreator = sourceOrg?.personalOwnerUserId === localUserId;
			const isSourceOrgOwner = sourceMembership?.role === "owner";
			const canMove =
				Boolean(sourceMembership) &&
				(isEvidenceCreator || isSourceOrgCreator || isSourceOrgOwner);

			if (!canMove) {
				set.status = 403;
				return {
					error: {
						code: "EVIDENCE_MOVE_FORBIDDEN",
						message: "Only permitted creators can move this evidence",
						status: 403,
						requestId: requestId ?? null,
					},
				};
			}

			const now = Date.now();
			const moved = await db.transaction(async (tx) => {
				const invalidatedShareLinks = await tx
					.delete(shareLinks)
					.where(eq(shareLinks.evidenceId, evidence.id))
					.returning({ id: shareLinks.id });

				const [updatedEvidence] = await tx
					.update(evidences)
					.set({
						orgId: body.targetOrgId,
						scopeId:
							evidence.scopeType === "organization"
								? body.targetOrgId
								: evidence.scopeId,
						updatedAt: now,
					})
					.where(eq(evidences.id, evidence.id))
					.returning({ id: evidences.id, orgId: evidences.orgId });

				if (!updatedEvidence) {
					throw new Error("Failed to move evidence");
				}

				return {
					evidenceId: updatedEvidence.id,
					orgId: updatedEvidence.orgId,
					invalidatedShareLinks: invalidatedShareLinks.length,
				};
			});

			requestLogger?.info(
				{
					event: "evidence.moved",
					evidenceId: moved.evidenceId,
					movedByUserId: localUserId,
					fromOrgId: evidence.orgId,
					toOrgId: moved.orgId,
					invalidatedShareLinks: moved.invalidatedShareLinks,
					requestId: requestId ?? null,
				},
				"evidence move completed",
			);

			return {
				evidence: {
					id: moved.evidenceId,
					orgId: moved.orgId,
				},
				move: {
					movedAt: now,
					movedBy: localUserId,
					fromOrgId: evidence.orgId,
					toOrgId: moved.orgId,
					invalidatedShareLinks: moved.invalidatedShareLinks,
				},
			};
		},
		{
			body: moveEvidenceBodySchema,
			detail: {
				tags: ["evidences"],
				summary: "Moves evidence to another organization",
			},
		},
	);
