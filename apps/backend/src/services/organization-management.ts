import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import type { z } from "zod/v4";
import {
	createOrganizationInputSchema,
	createOrganizationInvitationCodeInputSchema,
	createOrganizationInvitationInputSchema,
	createOrganizationMembershipInputSchema,
	type organizationInvitationCodeRoleSchema,
	organizationInvitationCodes,
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
	guestExpiresAt: number | null;
};

export type InvitationSummary = {
	id: string;
	email: string;
	role: "owner" | "moderator" | "member";
	status: "pending" | "accepted" | "revoked" | "expired";
	expiresAt: number;
	createdAt: number;
	invitedBy: string;
};

export type CreatedInvitation = InvitationSummary & {
	token: string;
	organizationId: string;
};

export type InvitationCodeSummary = {
	id: string;
	label: string;
	role: "moderator" | "member";
	hasPassword: boolean;
	emailDomain: string | null;
	expiresAt: number | null;
	guestExpiresAfterDays: number | null;
	lockedAt: number | null;
	createdAt: number;
	createdBy: string;
};

export type CreatedInvitationCode = InvitationCodeSummary & {
	code: string;
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

export const generateInvitationCode = (): string =>
	`join_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

export const hashInvitationToken = (token: string): Promise<string> =>
	sha256Hex(token);

const hashInvitationCodePassword = (code: string, password: string) =>
	sha256Hex(`${code}:${password}`);

const normalizeDomain = (domain: string | null | undefined): string | null => {
	const trimmed = domain?.trim().toLowerCase().replace(/^@/, "") ?? "";
	return trimmed ? trimmed : null;
};

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

export const getOrganizationRole = async (
	db: BackendDb,
	args: { organizationId: string; localUserId: string },
): Promise<string | null> => {
	const membership = await db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.organizationId, args.organizationId),
			eq(organizationMembers.userId, args.localUserId),
			isNull(organizationMembers.teamId),
		),
		columns: { role: true },
	});
	return membership?.role ?? null;
};

export const ensureOrganizationOwner = async (
	db: BackendDb,
	args: { organizationId: string; localUserId: string },
): Promise<boolean> => (await getOrganizationRole(db, args)) === "owner";

export const ensureOrganizationManager = async (
	db: BackendDb,
	args: { organizationId: string; localUserId: string },
): Promise<boolean> => {
	const role = await getOrganizationRole(db, args);
	return role === "owner" || role === "moderator";
};

export const ensureOrganizationMember = async (
	db: BackendDb,
	args: { organizationId: string; localUserId: string },
): Promise<boolean> => Boolean(await getOrganizationRole(db, args));

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
			guestExpiresAt: true,
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
				guestExpiresAt: membership.guestExpiresAt,
			};
		}),
	);

	return summaries.sort((a, b) => a.joinedAt - b.joinedAt);
};

export const renameOrganization = async (
	db: BackendDb,
	args: { organizationId: string; name: string },
): Promise<void> => {
	await db
		.update(organizations)
		.set({ name: args.name.trim(), updatedAt: Date.now() })
		.where(eq(organizations.id, args.organizationId));
};

export const updateOrganizationMemberRole = async (
	db: BackendDb,
	args: {
		organizationId: string;
		actorLocalUserId: string;
		membershipId: string;
		role: "moderator" | "member";
	},
): Promise<void> => {
	const actorRole = await getOrganizationRole(db, {
		organizationId: args.organizationId,
		localUserId: args.actorLocalUserId,
	});
	const target = await db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.id, args.membershipId),
			eq(organizationMembers.organizationId, args.organizationId),
			isNull(organizationMembers.teamId),
		),
		columns: { role: true, userId: true },
	});
	if (!target) throw new Error("Member not found.");
	if (target.role === "owner") {
		throw new Error("Owners cannot be changed from this screen.");
	}
	if (actorRole !== "owner" && target.role !== "member") {
		throw new Error("Moderators can only manage regular members.");
	}
	if (actorRole !== "owner" && args.role !== "member") {
		throw new Error("Only owners can promote moderators.");
	}

	await db
		.update(organizationMembers)
		.set({ role: args.role })
		.where(eq(organizationMembers.id, args.membershipId));
};

export const removeOrganizationMember = async (
	db: BackendDb,
	args: {
		organizationId: string;
		actorLocalUserId: string;
		membershipId: string;
	},
): Promise<void> => {
	const actorRole = await getOrganizationRole(db, {
		organizationId: args.organizationId,
		localUserId: args.actorLocalUserId,
	});
	const target = await db.query.organizationMembers.findFirst({
		where: and(
			eq(organizationMembers.id, args.membershipId),
			eq(organizationMembers.organizationId, args.organizationId),
			isNull(organizationMembers.teamId),
		),
		columns: { role: true, userId: true },
	});
	if (!target) throw new Error("Member not found.");
	if (target.userId === args.actorLocalUserId) {
		throw new Error("You cannot remove yourself from the organization.");
	}
	if (target.role === "owner") {
		throw new Error("Owners cannot be removed from this screen.");
	}
	if (actorRole !== "owner" && target.role !== "member") {
		throw new Error("Moderators can only manage regular members.");
	}
	await db
		.delete(organizationMembers)
		.where(eq(organizationMembers.id, args.membershipId));
};

const summarizeInvitation = (row: {
	id: string;
	email: string;
	role: "owner" | "moderator" | "member" | string;
	status: string;
	expiresAt: number;
	createdAt: number;
	invitedBy: string;
}): InvitationSummary => ({
	id: row.id,
	email: row.email,
	role:
		row.role === "owner"
			? "owner"
			: row.role === "moderator"
				? "moderator"
				: "member",
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

const summarizeInvitationCode = (row: {
	id: string;
	label: string;
	role: "moderator" | "member" | string;
	passwordHash: string | null;
	emailDomain: string | null;
	expiresAt: number | null;
	guestExpiresAfterDays: number | null;
	lockedAt: number | null;
	createdAt: number;
	createdBy: string;
}): InvitationCodeSummary => ({
	id: row.id,
	label: row.label,
	role: row.role === "moderator" ? "moderator" : "member",
	hasPassword: Boolean(row.passwordHash),
	emailDomain: row.emailDomain,
	expiresAt: row.expiresAt,
	guestExpiresAfterDays: row.guestExpiresAfterDays,
	lockedAt: row.lockedAt,
	createdAt: row.createdAt,
	createdBy: row.createdBy,
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
	args: { organizationId: string; invitationId: string },
): Promise<InvitationSummary | null> => {
	const now = Date.now();
	const [updated] = await db
		.update(organizationInvitations)
		.set({ status: "revoked", revokedAt: now, updatedAt: now })
		.where(
			and(
				eq(organizationInvitations.id, args.invitationId),
				eq(organizationInvitations.organizationId, args.organizationId),
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

export const listOrganizationInvitationCodes = async (
	db: BackendDb,
	organizationId: string,
): Promise<InvitationCodeSummary[]> => {
	const rows = await db.query.organizationInvitationCodes.findMany({
		where: eq(organizationInvitationCodes.organizationId, organizationId),
		columns: {
			id: true,
			label: true,
			role: true,
			passwordHash: true,
			emailDomain: true,
			expiresAt: true,
			guestExpiresAfterDays: true,
			lockedAt: true,
			createdAt: true,
			createdBy: true,
		},
		orderBy: desc(organizationInvitationCodes.createdAt),
	});
	return rows.map(summarizeInvitationCode);
};

export const createOrganizationInvitationCode = async (
	db: BackendDb,
	args: {
		organizationId: string;
		label: string;
		role: z.infer<typeof organizationInvitationCodeRoleSchema>;
		createdBy: string;
		password?: string;
		emailDomain?: string | null;
		expiresAt?: number | null;
		guestExpiresAfterDays?: number | null;
	},
): Promise<CreatedInvitationCode> => {
	const existing = await db.query.organizationInvitationCodes.findMany({
		where: eq(organizationInvitationCodes.organizationId, args.organizationId),
		columns: { id: true },
	});
	if (existing.length >= 3) {
		throw new Error("An organization can only have up to 3 invitation codes.");
	}

	const code = generateInvitationCode();
	const parsed = createOrganizationInvitationCodeInputSchema.parse({
		organizationId: args.organizationId,
		label: args.label,
		role: args.role,
		codeHash: await hashInvitationToken(code),
		passwordHash: args.password
			? await hashInvitationCodePassword(code, args.password)
			: null,
		emailDomain: normalizeDomain(args.emailDomain),
		expiresAt: args.expiresAt ?? null,
		guestExpiresAfterDays: args.guestExpiresAfterDays ?? null,
		createdBy: args.createdBy,
	});

	const [created] = await db
		.insert(organizationInvitationCodes)
		.values(parsed)
		.returning({
			id: organizationInvitationCodes.id,
			label: organizationInvitationCodes.label,
			role: organizationInvitationCodes.role,
			passwordHash: organizationInvitationCodes.passwordHash,
			emailDomain: organizationInvitationCodes.emailDomain,
			expiresAt: organizationInvitationCodes.expiresAt,
			guestExpiresAfterDays: organizationInvitationCodes.guestExpiresAfterDays,
			lockedAt: organizationInvitationCodes.lockedAt,
			createdAt: organizationInvitationCodes.createdAt,
			createdBy: organizationInvitationCodes.createdBy,
		});
	if (!created) throw new Error("Failed to create invitation code");
	return {
		...summarizeInvitationCode(created),
		code,
		organizationId: args.organizationId,
	};
};

export const setOrganizationInvitationCodeLocked = async (
	db: BackendDb,
	args: { organizationId: string; codeId: string; locked: boolean },
): Promise<InvitationCodeSummary | null> => {
	const [updated] = await db
		.update(organizationInvitationCodes)
		.set({ lockedAt: args.locked ? Date.now() : null, updatedAt: Date.now() })
		.where(
			and(
				eq(organizationInvitationCodes.id, args.codeId),
				eq(organizationInvitationCodes.organizationId, args.organizationId),
			),
		)
		.returning({
			id: organizationInvitationCodes.id,
			label: organizationInvitationCodes.label,
			role: organizationInvitationCodes.role,
			passwordHash: organizationInvitationCodes.passwordHash,
			emailDomain: organizationInvitationCodes.emailDomain,
			expiresAt: organizationInvitationCodes.expiresAt,
			guestExpiresAfterDays: organizationInvitationCodes.guestExpiresAfterDays,
			lockedAt: organizationInvitationCodes.lockedAt,
			createdAt: organizationInvitationCodes.createdAt,
			createdBy: organizationInvitationCodes.createdBy,
		});
	return updated ? summarizeInvitationCode(updated) : null;
};

export const deleteOrganizationInvitationCode = async (
	db: BackendDb,
	args: { organizationId: string; codeId: string },
): Promise<boolean> => {
	await db
		.delete(organizationInvitationCodes)
		.where(
			and(
				eq(organizationInvitationCodes.id, args.codeId),
				eq(organizationInvitationCodes.organizationId, args.organizationId),
			),
		);
	return true;
};

export const lookupInvitationCode = async (
	db: BackendDb,
	code: string,
): Promise<{
	codeId: string;
	organizationId: string;
	label: string;
	requiresPassword: boolean;
	emailDomain: string | null;
	guestExpiresAfterDays: number | null;
} | null> => {
	const row = await db.query.organizationInvitationCodes.findFirst({
		where: eq(
			organizationInvitationCodes.codeHash,
			await hashInvitationToken(code),
		),
		columns: {
			id: true,
			organizationId: true,
			label: true,
			passwordHash: true,
			emailDomain: true,
			expiresAt: true,
			guestExpiresAfterDays: true,
			lockedAt: true,
		},
	});
	if (
		!row ||
		row.lockedAt ||
		(row.expiresAt !== null && row.expiresAt <= Date.now())
	) {
		return null;
	}
	return {
		codeId: row.id,
		organizationId: row.organizationId,
		label: row.label,
		requiresPassword: Boolean(row.passwordHash),
		emailDomain: row.emailDomain,
		guestExpiresAfterDays: row.guestExpiresAfterDays,
	};
};

export const acceptInvitationByToken = async (
	db: BackendDb,
	args: {
		token: string;
		localUserId: string;
		userEmail?: string | null;
		password?: string;
	},
): Promise<{
	organizationId: string;
	role: "owner" | "moderator" | "member";
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
			},
		});
		if (invitation) {
			const role =
				invitation.role === "owner"
					? "owner"
					: invitation.role === "moderator"
						? "moderator"
						: "member";

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
		}

		const code = await tx.query.organizationInvitationCodes.findFirst({
			where: eq(organizationInvitationCodes.codeHash, tokenHash),
			columns: {
				id: true,
				organizationId: true,
				role: true,
				passwordHash: true,
				emailDomain: true,
				expiresAt: true,
				guestExpiresAfterDays: true,
				lockedAt: true,
			},
		});
		if (
			!code ||
			code.lockedAt ||
			(code.expiresAt !== null && code.expiresAt <= now)
		) {
			throw new Error("Invitation is invalid, expired, or locked.");
		}
		if (code.passwordHash) {
			if (!args.password)
				throw new Error("This invitation code requires a password.");
			const incomingHash = await hashInvitationCodePassword(
				args.token,
				args.password,
			);
			if (incomingHash !== code.passwordHash) {
				throw new Error("Invitation code password is incorrect.");
			}
		}
		if (code.emailDomain) {
			const email = args.userEmail?.trim().toLowerCase() ?? "";
			if (!email.endsWith(`@${code.emailDomain}`)) {
				throw new Error(
					`This invitation code only accepts ${code.emailDomain} email addresses.`,
				);
			}
		}

		const role = code.role === "moderator" ? "moderator" : "member";
		const guestExpiresAt = code.guestExpiresAfterDays
			? now + code.guestExpiresAfterDays * 24 * 60 * 60 * 1000
			: null;
		await tx
			.insert(organizationMembers)
			.values({
				organizationId: code.organizationId,
				userId: args.localUserId,
				role,
				guestExpiresAt,
				invitationCodeId: code.id,
			})
			.onConflictDoNothing();

		await tx
			.update(organizationMembers)
			.set({ role, guestExpiresAt, invitationCodeId: code.id })
			.where(
				and(
					eq(organizationMembers.organizationId, code.organizationId),
					eq(organizationMembers.userId, args.localUserId),
					isNull(organizationMembers.teamId),
				),
			);

		await tx
			.update(users)
			.set({ activeOrgId: code.organizationId, updatedAt: now })
			.where(eq(users.id, args.localUserId));

		return {
			organizationId: code.organizationId,
			role,
			invitationId: code.id,
		};
	});
};

export const cleanupExpiredGuestMemberships = async (
	db: BackendDb,
	now = Date.now(),
): Promise<number> => {
	const expired = await db.query.organizationMembers.findMany({
		where: and(
			lt(organizationMembers.guestExpiresAt, now),
			isNull(organizationMembers.teamId),
		),
		columns: { id: true, role: true },
	});
	const removable = expired.filter((row) => row.role !== "owner");
	for (const row of removable) {
		await db
			.delete(organizationMembers)
			.where(eq(organizationMembers.id, row.id));
	}
	return removable.length;
};
