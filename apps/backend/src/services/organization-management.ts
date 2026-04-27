import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { z } from "zod";
import {
	createOrganizationInputSchema,
	createOrganizationInvitationInputSchema,
	createOrganizationMembershipInputSchema,
	type organizationInvitationRoleSchema,
	organizationInvitations,
	organizationMembers,
	organizations,
	users,
} from "../db/schema";
import {
	fallbackClerkUserProfile,
	formatClerkDisplayName,
	resolveClerkUserProfile,
} from "./clerk-user-profile";
import type { BackendDb } from "./user-provisioning";

export type OrganizationSummary = {
	id: string;
	name: string;
	role: string;
	isPersonal: boolean;
	memberCount: number;
	createdAt: number;
};

export type OrganizationMemberSummary = {
	membershipId: string;
	userId: string;
	clerkUserId: string;
	firstName: string | null;
	lastName: string | null;
	displayName: string;
	email: string | null;
	role: string;
	joinedAt: number;
};

export type InvitationSummary = {
	id: string;
	email: string;
	role: "owner" | "member";
	status: "pending" | "accepted" | "revoked" | "expired";
	expiresAt: number;
	createdAt: number;
	invitedBy: string;
};

export type CreatedInvitation = InvitationSummary & {
	token: string;
	organizationId: string;
};

const sha256Hex = async (value: string): Promise<string> => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};

export const generateInvitationToken = (): string =>
	`inv_${crypto.randomUUID().replace(/-/g, "")}`;

export const hashInvitationToken = (token: string): Promise<string> =>
	sha256Hex(token);

export const createOrganization = async (
	db: BackendDb,
	input: { name: string; createdByLocalUserId: string },
): Promise<OrganizationSummary> => {
	const parsed = createOrganizationInputSchema.parse({
		name: input.name,
		isPersonal: false,
		personalOwnerUserId: null,
	});

	return db.transaction(async (tx) => {
		const [organization] = await tx
			.insert(organizations)
			.values({
				name: parsed.name,
				isPersonal: false,
				personalOwnerUserId: null,
			})
			.returning({
				id: organizations.id,
				name: organizations.name,
				isPersonal: organizations.isPersonal,
				createdAt: organizations.createdAt,
			});

		if (!organization) {
			throw new Error("Failed to create organization");
		}

		const membership = createOrganizationMembershipInputSchema.parse({
			organizationId: organization.id,
			userId: input.createdByLocalUserId,
			role: "owner",
		});

		await tx
			.insert(organizationMembers)
			.values(membership)
			.onConflictDoNothing();

		await tx
			.update(users)
			.set({ activeOrgId: organization.id, updatedAt: Date.now() })
			.where(eq(users.id, input.createdByLocalUserId));

		return {
			id: organization.id,
			name: organization.name,
			role: "owner",
			isPersonal: organization.isPersonal,
			memberCount: 1,
			createdAt: organization.createdAt,
		};
	});
};

export const listOrganizationsForUser = async (
	db: BackendDb,
	localUserId: string,
): Promise<OrganizationSummary[]> => {
	const memberships = await db.query.organizationMembers.findMany({
		where: and(
			eq(organizationMembers.userId, localUserId),
			isNull(organizationMembers.teamId),
		),
		columns: { organizationId: true, role: true },
		with: {
			organization: {
				columns: {
					id: true,
					name: true,
					isPersonal: true,
					createdAt: true,
				},
			},
		},
	});

	const counts = new Map<string, number>();
	for (const membership of memberships) {
		const allMembers = await db.query.organizationMembers.findMany({
			where: and(
				eq(organizationMembers.organizationId, membership.organizationId),
				isNull(organizationMembers.teamId),
			),
			columns: { id: true },
		});
		counts.set(membership.organizationId, allMembers.length);
	}

	return memberships.map((membership) => ({
		id: membership.organization.id,
		name: membership.organization.name,
		role: membership.role,
		isPersonal: membership.organization.isPersonal,
		memberCount: counts.get(membership.organizationId) ?? 1,
		createdAt: membership.organization.createdAt,
	}));
};

export const ensureOrganizationOwner = async (
	db: BackendDb,
	args: { organizationId: string; localUserId: string },
): Promise<boolean> => {
	const membership = await db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.organizationId, args.organizationId),
			eq(organizationMembers.userId, args.localUserId),
			isNull(organizationMembers.teamId),
		),
		columns: { role: true },
	});
	return membership?.role === "owner";
};

export const ensureOrganizationMember = async (
	db: BackendDb,
	args: { organizationId: string; localUserId: string },
): Promise<boolean> => {
	const membership = await db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.organizationId, args.organizationId),
			eq(organizationMembers.userId, args.localUserId),
			isNull(organizationMembers.teamId),
		),
		columns: { id: true },
	});
	return Boolean(membership);
};

export const listOrganizationMembers = async (
	db: BackendDb,
	organizationId: string,
	runtime: { clerkSecretKey: string | undefined },
): Promise<OrganizationMemberSummary[]> => {
	const memberships = await db.query.organizationMembers.findMany({
		where: and(
			eq(organizationMembers.organizationId, organizationId),
			isNull(organizationMembers.teamId),
		),
		columns: {
			id: true,
			userId: true,
			role: true,
			createdAt: true,
		},
		with: {
			user: {
				columns: { clerkUserId: true },
			},
		},
	});

	const summaries = await Promise.all(
		memberships.map(async (membership) => {
			const profile = await resolveClerkUserProfile(
				runtime,
				membership.user.clerkUserId,
			).catch(() => fallbackClerkUserProfile(membership.user.clerkUserId));

			return {
				membershipId: membership.id,
				userId: membership.userId,
				clerkUserId: membership.user.clerkUserId,
				firstName: profile.firstName,
				lastName: profile.lastName,
				displayName: formatClerkDisplayName({
					clerkUserId: membership.user.clerkUserId,
					firstName: profile.firstName,
					lastName: profile.lastName,
					username: profile.username,
					email: profile.email,
				}),
				email: profile.email,
				role: membership.role,
				joinedAt: membership.createdAt,
			};
		}),
	);

	return summaries.sort((a, b) => a.joinedAt - b.joinedAt);
};

const summarizeInvitation = (row: {
	id: string;
	email: string;
	role: "owner" | "member" | string;
	status: string;
	expiresAt: number;
	createdAt: number;
	invitedBy: string;
}): InvitationSummary => ({
	id: row.id,
	email: row.email,
	role: row.role === "owner" ? "owner" : "member",
	status:
		row.status === "accepted"
			? "accepted"
			: row.status === "revoked"
				? "revoked"
				: row.status === "expired"
					? "expired"
					: "pending",
	expiresAt: row.expiresAt,
	createdAt: row.createdAt,
	invitedBy: row.invitedBy,
});

export const createOrganizationInvitation = async (
	db: BackendDb,
	args: {
		organizationId: string;
		email: string;
		role: z.infer<typeof organizationInvitationRoleSchema>;
		invitedBy: string;
		ttlMs?: number;
	},
): Promise<CreatedInvitation> => {
	const ttl = args.ttlMs ?? 1000 * 60 * 60 * 24 * 7;
	const token = generateInvitationToken();
	const tokenHash = await hashInvitationToken(token);

	const parsed = createOrganizationInvitationInputSchema.parse({
		organizationId: args.organizationId,
		email: args.email,
		role: args.role,
		tokenHash,
		expiresAt: Date.now() + ttl,
		invitedBy: args.invitedBy,
	});

	const [created] = await db
		.insert(organizationInvitations)
		.values(parsed)
		.returning({
			id: organizationInvitations.id,
			email: organizationInvitations.email,
			role: organizationInvitations.role,
			status: organizationInvitations.status,
			expiresAt: organizationInvitations.expiresAt,
			createdAt: organizationInvitations.createdAt,
			invitedBy: organizationInvitations.invitedBy,
		});

	if (!created) {
		throw new Error("Failed to create invitation");
	}

	return {
		...summarizeInvitation(created),
		organizationId: args.organizationId,
		token,
	};
};

export const listOrganizationInvitations = async (
	db: BackendDb,
	organizationId: string,
): Promise<InvitationSummary[]> => {
	const rows = await db.query.organizationInvitations.findMany({
		where: eq(organizationInvitations.organizationId, organizationId),
		columns: {
			id: true,
			email: true,
			role: true,
			status: true,
			expiresAt: true,
			createdAt: true,
			invitedBy: true,
		},
		orderBy: desc(organizationInvitations.createdAt),
	});
	return rows.map(summarizeInvitation);
};

export const revokeOrganizationInvitation = async (
	db: BackendDb,
	invitationId: string,
): Promise<InvitationSummary | null> => {
	const now = Date.now();
	const [updated] = await db
		.update(organizationInvitations)
		.set({ status: "revoked", revokedAt: now, updatedAt: now })
		.where(
			and(
				eq(organizationInvitations.id, invitationId),
				eq(organizationInvitations.status, "pending"),
			),
		)
		.returning({
			id: organizationInvitations.id,
			email: organizationInvitations.email,
			role: organizationInvitations.role,
			status: organizationInvitations.status,
			expiresAt: organizationInvitations.expiresAt,
			createdAt: organizationInvitations.createdAt,
			invitedBy: organizationInvitations.invitedBy,
		});
	return updated ? summarizeInvitation(updated) : null;
};

export const acceptInvitationByToken = async (
	db: BackendDb,
	args: { token: string; localUserId: string },
): Promise<{
	organizationId: string;
	role: "owner" | "member";
	invitationId: string;
}> => {
	const tokenHash = await hashInvitationToken(args.token);
	const now = Date.now();

	return db.transaction(async (tx) => {
		const invitation = await tx.query.organizationInvitations.findFirst({
			where: and(
				eq(organizationInvitations.tokenHash, tokenHash),
				eq(organizationInvitations.status, "pending"),
				gt(organizationInvitations.expiresAt, now),
			),
			columns: {
				id: true,
				organizationId: true,
				role: true,
				expiresAt: true,
			},
		});
		if (!invitation) {
			throw new Error("Invitation is invalid, expired, or already used.");
		}

		const role: "owner" | "member" =
			invitation.role === "owner" ? "owner" : "member";

		await tx
			.insert(organizationMembers)
			.values({
				organizationId: invitation.organizationId,
				userId: args.localUserId,
				role,
			})
			.onConflictDoNothing();

		await tx
			.update(organizationInvitations)
			.set({
				status: "accepted",
				acceptedBy: args.localUserId,
				acceptedAt: now,
				updatedAt: now,
			})
			.where(eq(organizationInvitations.id, invitation.id));

		await tx
			.update(users)
			.set({ activeOrgId: invitation.organizationId, updatedAt: now })
			.where(eq(users.id, args.localUserId));

		return {
			organizationId: invitation.organizationId,
			role,
			invitationId: invitation.id,
		};
	});
};
