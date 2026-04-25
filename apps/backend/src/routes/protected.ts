import { createClerkClient } from "@clerk/backend";
import { and, eq, isNull } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { organizationMembers } from "../db/schema";
import { apiErrorSchema } from "../http/api-error";
import type { ClerkAuthPlugin } from "../plugins/clerk-auth";

type ClerkUserSummary = {
	id: string;
	displayName: string;
	email: string | null;
	imageUrl: string | null;
};

const userSummarySchema = t.Object({
	id: t.String({ minLength: 1 }),
	displayName: t.String({ minLength: 1 }),
	email: t.Union([t.String({ minLength: 1 }), t.Null()]),
	imageUrl: t.Union([t.String({ minLength: 1 }), t.Null()]),
});

const organizationSummarySchema = t.Object({
	id: t.String({ minLength: 1 }),
	name: t.String({ minLength: 1 }),
	role: t.String({ minLength: 1 }),
	isPersonal: t.Boolean(),
	isActive: t.Boolean(),
});

const protectedMeResponseSchema = t.Object({
	userId: t.String({ minLength: 1 }),
	orgId: t.Union([t.String({ minLength: 1 }), t.Null()]),
	activeOrgId: t.Union([t.String({ minLength: 1 }), t.Null()]),
	roles: t.Array(t.String({ minLength: 1 })),
	scopes: t.Array(t.String({ minLength: 1 })),
	user: userSummarySchema,
	organizations: t.Array(organizationSummarySchema),
});

const formatClerkDisplayName = (input: {
	clerkUserId: string;
	firstName?: string | null;
	lastName?: string | null;
	username?: string | null;
	email?: string | null;
}) => {
	const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ");
	return fullName || input.username || input.email || input.clerkUserId;
};

const resolveClerkUserSummary = async (
	runtime: { clerkSecretKey: string | undefined },
	clerkUserId: string,
): Promise<ClerkUserSummary> => {
	if (!runtime.clerkSecretKey) {
		return {
			id: clerkUserId,
			displayName: clerkUserId,
			email: null,
			imageUrl: null,
		};
	}

	const clerkClient = createClerkClient({ secretKey: runtime.clerkSecretKey });
	const user = await clerkClient.users.getUser(clerkUserId);
	const primaryEmail =
		user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)
			?.emailAddress ??
		user.emailAddresses[0]?.emailAddress ??
		null;

	return {
		id: user.id,
		displayName: formatClerkDisplayName({
			clerkUserId,
			firstName: user.firstName,
			lastName: user.lastName,
			username: user.username,
			email: primaryEmail,
		}),
		email: primaryEmail,
		imageUrl: user.imageUrl || null,
	};
};

export const createProtectedRoutes = (auth: ClerkAuthPlugin) =>
	new Elysia({ name: "protected-routes" })
		.use(auth)
		.guard({ auth: true }, (app) =>
			app.get(
				"/protected/me",
				async ({ authContext, db, requestLogger, runtime }) => {
					let user: ClerkUserSummary = {
						id: authContext.userId,
						displayName: authContext.userId,
						email: null,
						imageUrl: null,
					};
					try {
						user = await resolveClerkUserSummary(runtime, authContext.userId);
					} catch (error) {
						requestLogger.warn(
							{ err: error, clerkUserId: authContext.userId },
							"failed to resolve Clerk user profile",
						);
					}

					const memberships =
						db && authContext.localUserId
							? await db.query.organizationMembers.findMany({
									where: and(
										eq(organizationMembers.userId, authContext.localUserId),
										isNull(organizationMembers.teamId),
									),
									columns: {
										organizationId: true,
										role: true,
									},
									with: {
										organization: {
											columns: {
												id: true,
												name: true,
												isPersonal: true,
											},
										},
									},
								})
							: [];

					const organizations = memberships.map((membership) => ({
						id: membership.organization.id,
						name: membership.organization.name,
						role: membership.role,
						isPersonal: membership.organization.isPersonal,
						isActive: membership.organization.id === authContext.activeOrgId,
					}));

					return {
						userId: authContext.userId,
						orgId: authContext.orgId,
						activeOrgId: authContext.activeOrgId,
						roles: authContext.roles,
						scopes: authContext.scopes,
						user,
						organizations,
					};
				},
				{
					detail: {
						tags: ["auth"],
						summary: "Returns auth context for current request",
					},
					response: {
						200: protectedMeResponseSchema,
						401: apiErrorSchema,
						500: apiErrorSchema,
					},
				},
			),
		);
