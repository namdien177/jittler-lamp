import { and, eq } from "drizzle-orm";

import { organizationMembers } from "../db/schema";

import type { BackendDb } from "./user-provisioning";

type TeamPolicyContext = {
	organizationId: string;
	teamId: string | null;
	userId: string;
	action: "view" | "share" | "move";
};

type TeamPolicyAdapter = {
	canViewEvidence?: (context: TeamPolicyContext) => Promise<boolean>;
	canShareEvidence?: (context: TeamPolicyContext) => Promise<boolean>;
	canMoveEvidence?: (context: TeamPolicyContext) => Promise<boolean>;
};

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

const authorizeTeamAction = async (
	teamPolicyAdapter: TeamPolicyAdapter | undefined,
	action: TeamPolicyContext["action"],
	context: EvidenceAccessContext,
): Promise<boolean> => {
	if (!context.teamId) {
		return true;
	}

	const teamContext: TeamPolicyContext = {
		organizationId: context.organizationId,
		teamId: context.teamId,
		userId: context.userId,
		action,
	};

	switch (action) {
		case "view":
			return (await teamPolicyAdapter?.canViewEvidence?.(teamContext)) ?? true;
		case "share":
			return (await teamPolicyAdapter?.canShareEvidence?.(teamContext)) ?? true;
		case "move":
			return (await teamPolicyAdapter?.canMoveEvidence?.(teamContext)) ?? true;
	}
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
	const teamPolicyAdapter = deps.teamPolicyAdapter;

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

			return authorizeTeamAction(teamPolicyAdapter, "view", context);
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

			return authorizeTeamAction(teamPolicyAdapter, "share", context);
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

			return authorizeTeamAction(teamPolicyAdapter, "move", context);
		},
	};
};
