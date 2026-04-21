import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { Logger } from "pino";

import {
	evidences,
	organizationMembers,
	organizations,
	shareLinks,
	users,
} from "../db/schema";
import { authContext } from "../middleware/auth-context";
import { createEvidencePolicy } from "../services/evidence-policy";

import type { BackendDb } from "../services/user-provisioning";

const moveEvidenceBodySchema = t.Object({
	targetOrgId: t.String({ minLength: 1 }),
});

type EvidenceMoveRouteContext = {
	requestId?: string;
	logger?: Pick<Logger, "info">;
	store: {
		db?: BackendDb;
	};
};

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
			const typedCtx = ctx as typeof ctx & EvidenceMoveRouteContext;
			const { authContext, body, params, set } = typedCtx;
			const requestId = typedCtx.requestId;
			const requestLogger = typedCtx.logger;
			const db = typedCtx.store.db;

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
					teamId: true,
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

			const evidencePolicy = createEvidencePolicy();
			const sourceOrg = await db.query.organizations.findFirst({
				where: eq(organizations.id, evidence.orgId),
				columns: { personalOwnerUserId: true },
			});

			const canMove = await evidencePolicy.canMoveEvidence(db, {
				organizationId: evidence.orgId,
				teamId: evidence.teamId,
				userId: localUserId,
				sourceOrganizationId: evidence.orgId,
				targetOrganizationId: body.targetOrgId,
				isEvidenceCreator: evidence.createdBy === localUserId,
				isSourceOrganizationCreator:
					sourceOrg?.personalOwnerUserId === localUserId,
			});

			const hasTargetMembership = await db.query.organizationMembers.findFirst({
				where: and(
					eq(organizationMembers.organizationId, body.targetOrgId),
					eq(organizationMembers.userId, localUserId),
				),
				columns: { id: true },
			});

			if (!hasTargetMembership) {
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
