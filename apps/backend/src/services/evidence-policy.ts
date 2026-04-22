import { and, eq, isNull } from "drizzle-orm";

import { organizationMembers } from "../db/schema";

import type { BackendDb } from "./user-provisioning";

type TeamEvidenceAccessPolicyContext = {
	organizationId: string;
	teamId: string;
	userId: string;
};

type TeamPolicyAdapter = {
	canViewEvidence: (
		context: TeamEvidenceAccessPolicyContext,
	) => Promise<boolean>;
	canShareEvidence: (
		context: TeamEvidenceAccessPolicyContext,
	) => Promise<boolean>;
	canMoveEvidence: (
		context: EvidenceMoveContext & { teamId: string },
	) => Promise<boolean>;
};

const defaultTeamPolicyAdapter: TeamPolicyAdapter = {
	canViewEvidence: async () => true,
	canShareEvidence: async () => true,
	canMoveEvidence: async () => true,
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
	teamPolicyAdapter: TeamPolicyAdapter,
	action: "view" | "share",
	context: EvidenceAccessContext,
): Promise<boolean> => {
	if (!context.teamId) {
		return true;
	}

	const teamContext: TeamEvidenceAccessPolicyContext = {
		organizationId: context.organizationId,
		teamId: context.teamId,
		userId: context.userId,
	};

	switch (action) {
		case "view":
			return teamPolicyAdapter.canViewEvidence(teamContext);
		case "share":
			return teamPolicyAdapter.canShareEvidence(teamContext);
	}
};

const authorizeTeamMoveAction = async (
	teamPolicyAdapter: TeamPolicyAdapter,
	context: EvidenceMoveContext,
): Promise<boolean> => {
	if (!context.teamId) {
		return true;
	}

	return teamPolicyAdapter.canMoveEvidence({
		...context,
		teamId: context.teamId,
	});
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
			isNull(organizationMembers.teamId),
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
			isNull(organizationMembers.teamId),
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

			return authorizeTeamMoveAction(teamPolicyAdapter, context);
		},
	};
};
