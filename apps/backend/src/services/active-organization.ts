import { eq } from "drizzle-orm";

import { organizationMembers, organizations, users } from "../db/schema";
import type { BackendDb } from "./user-provisioning";

export type ResolvedActiveOrganization = {
	localUserId: string;
	organizationId: string;
};

export const resolveActiveOrganizationForClerkUser = async (
	db: BackendDb,
	clerkUserId: string,
	requestedOrganizationId?: string | null,
): Promise<ResolvedActiveOrganization | null> => {
	const localUser = await db.query.users.findFirst({
		where: eq(users.clerkUserId, clerkUserId),
		columns: { id: true },
		with: {
			organizationMemberships: {
				columns: { organizationId: true },
				with: {
					organization: {
						columns: { id: true, isPersonal: true },
					},
				},
			},
		},
	});

	if (!localUser) {
		return null;
	}

	const membershipByOrganizationId = new Set(
		localUser.organizationMemberships.map((membership) =>
			membership.organization.id,
		),
	);

	if (
		requestedOrganizationId &&
		membershipByOrganizationId.has(requestedOrganizationId)
	) {
		return {
			localUserId: localUser.id,
			organizationId: requestedOrganizationId,
		};
	}

	const personalMembership = localUser.organizationMemberships.find(
		(membership) => membership.organization.isPersonal,
	);

	if (personalMembership) {
		return {
			localUserId: localUser.id,
			organizationId: personalMembership.organizationId,
		};
	}

	const firstMembership = localUser.organizationMemberships[0];
	if (firstMembership) {
		return {
			localUserId: localUser.id,
			organizationId: firstMembership.organizationId,
		};
	}

	const ownedPersonalOrganization = await db.query.organizations.findFirst({
		where: eq(organizations.personalOwnerUserId, localUser.id),
		columns: { id: true },
	});
	if (!ownedPersonalOrganization) {
		return null;
	}

	await db.insert(organizationMembers).values({
		organizationId: ownedPersonalOrganization.id,
		userId: localUser.id,
		role: "owner",
	});

	return {
		localUserId: localUser.id,
		organizationId: ownedPersonalOrganization.id,
	};
};
