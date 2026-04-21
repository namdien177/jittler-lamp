import { and, eq } from "drizzle-orm";

import { organizationMembers } from "../db/schema";

import type { BackendDb } from "./user-provisioning";

type TeamPolicyContext = {
	organizationId: string;
	teamId: string | null;
	userId: string;
	action: "view" | "share" | "move";
};

type TeamPolicyAdapter = (context: TeamPolicyContext) => Promise<boolean>;

const defaultTeamPolicyAdapter: TeamPolicyAdapter = async () => true;

export type EvidencePolicyDeps = {
	teamPolicyAdapter?: TeamPolicyAdapter;
};

export type EvidenceAccessContext = {
	organizationId: string;
	teamId?: string | null;
	userId: string;
};

export type EvidenceMoveContext = EvidenceAccessContext & {
	sourceOrganizationId: string;
	targetOrganizationId: string;
	isEvidenceCreator: boolean;
	isSourceOrganizationCreator: boolean;
};

const hasOrgMembership = async (
	db: BackendDb,
	organizationId: string,
	userId: string,
): Promise<boolean> => {
	const membership = await db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.organizationId, organizationId),
			eq(organizationMembers.userId, userId),
		),
		columns: { id: true },
	});

	return Boolean(membership);
};

const resolveSourceMembershipRole = async (
	db: BackendDb,
	organizationId: string,
	userId: string,
): Promise<string | null> => {
	const membership = await db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.organizationId, organizationId),
			eq(organizationMembers.userId, userId),
		),
		columns: { role: true },
	});

	return membership?.role ?? null;
};

export const createEvidencePolicy = (deps: EvidencePolicyDeps = {}) => {
	const teamPolicyAdapter = deps.teamPolicyAdapter ?? defaultTeamPolicyAdapter;

	return {
		canViewEvidence: async (
			db: BackendDb,
			context: EvidenceAccessContext,
		): Promise<boolean> => {
			const hasMembership = await hasOrgMembership(
				db,
				context.organizationId,
				context.userId,
			);
			if (!hasMembership) {
				return false;
			}

			if (!context.teamId) {
				return true;
			}

			return teamPolicyAdapter({
				organizationId: context.organizationId,
				teamId: context.teamId,
				userId: context.userId,
				action: "view",
			});
		},
		canShareEvidence: async (
			db: BackendDb,
			context: EvidenceAccessContext,
		): Promise<boolean> => {
			const hasMembership = await hasOrgMembership(
				db,
				context.organizationId,
				context.userId,
			);
			if (!hasMembership) {
				return false;
			}

			if (!context.teamId) {
				return true;
			}

			return teamPolicyAdapter({
				organizationId: context.organizationId,
				teamId: context.teamId,
				userId: context.userId,
				action: "share",
			});
		},
		canMoveEvidence: async (
			db: BackendDb,
			context: EvidenceMoveContext,
		): Promise<boolean> => {
			const [hasSourceMembership, hasTargetMembership, sourceRole] =
				await Promise.all([
					hasOrgMembership(db, context.sourceOrganizationId, context.userId),
					hasOrgMembership(db, context.targetOrganizationId, context.userId),
					resolveSourceMembershipRole(
						db,
						context.sourceOrganizationId,
						context.userId,
					),
				]);

			if (!hasSourceMembership || !hasTargetMembership) {
				return false;
			}

			const isSourceOwner = sourceRole === "owner";
			if (
				!(
					context.isEvidenceCreator ||
					context.isSourceOrganizationCreator ||
					isSourceOwner
				)
			) {
				return false;
			}

			if (!context.teamId) {
				return true;
			}

			return teamPolicyAdapter({
				organizationId: context.organizationId,
				teamId: context.teamId,
				userId: context.userId,
				action: "move",
			});
		},
	};
};
