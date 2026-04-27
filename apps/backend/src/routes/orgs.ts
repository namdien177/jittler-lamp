import { Elysia, t } from "elysia";

import {
	apiErrorSchema,
	createApiError,
	createDbUnavailableError,
} from "../http/api-error";
import type { ClerkAuthPlugin } from "../plugins/clerk-auth";
import { selectActiveOrganizationForClerkUser } from "../services/active-organization";
import {
	acceptInvitationByToken,
	createOrganization,
	createOrganizationInvitation,
	ensureOrganizationMember,
	ensureOrganizationOwner,
	listOrganizationInvitations,
	listOrganizationMembers,
	listOrganizationsForUser,
	revokeOrganizationInvitation,
} from "../services/organization-management";

const organizationSummarySchema = t.Object({
	id: t.String({ minLength: 1 }),
	name: t.String({ minLength: 1 }),
	role: t.String({ minLength: 1 }),
	isPersonal: t.Boolean(),
	memberCount: t.Number({ minimum: 0 }),
	createdAt: t.Number(),
});

const organizationListResponseSchema = t.Object({
	organizations: t.Array(organizationSummarySchema),
});

const createOrganizationBodySchema = t.Object({
	name: t.String({ minLength: 1, maxLength: 100 }),
});

const createOrganizationResponseSchema = t.Object({
	organization: organizationSummarySchema,
});

const memberSummarySchema = t.Object({
	membershipId: t.String({ minLength: 1 }),
	userId: t.String({ minLength: 1 }),
	clerkUserId: t.String({ minLength: 1 }),
	firstName: t.Union([t.String({ minLength: 1 }), t.Null()]),
	lastName: t.Union([t.String({ minLength: 1 }), t.Null()]),
	displayName: t.String({ minLength: 1 }),
	email: t.Union([t.String({ minLength: 1 }), t.Null()]),
	role: t.String({ minLength: 1 }),
	joinedAt: t.Number(),
});

const memberListResponseSchema = t.Object({
	members: t.Array(memberSummarySchema),
});

const invitationSummarySchema = t.Object({
	id: t.String({ minLength: 1 }),
	email: t.String({ minLength: 1 }),
	role: t.Union([t.Literal("owner"), t.Literal("member")]),
	status: t.Union([
		t.Literal("pending"),
		t.Literal("accepted"),
		t.Literal("revoked"),
		t.Literal("expired"),
	]),
	expiresAt: t.Number(),
	createdAt: t.Number(),
	invitedBy: t.String({ minLength: 1 }),
});

const invitationListResponseSchema = t.Object({
	invitations: t.Array(invitationSummarySchema),
});

const createInvitationBodySchema = t.Object({
	email: t.String({ format: "email", minLength: 3, maxLength: 200 }),
	role: t.Optional(t.Union([t.Literal("owner"), t.Literal("member")])),
	ttlMs: t.Optional(
		t.Number({
			minimum: 60_000,
			maximum: 1000 * 60 * 60 * 24 * 60,
		}),
	),
});

const createdInvitationResponseSchema = t.Object({
	invitation: t.Composite([
		invitationSummarySchema,
		t.Object({
			organizationId: t.String({ minLength: 1 }),
			token: t.String({ minLength: 1 }),
		}),
	]),
});

const revokeResponseSchema = t.Object({
	invitation: invitationSummarySchema,
});

const acceptInvitationBodySchema = t.Object({
	token: t.String({ minLength: 1 }),
});

const acceptInvitationResponseSchema = t.Object({
	organizationId: t.String({ minLength: 1 }),
	role: t.Union([t.Literal("owner"), t.Literal("member")]),
	invitationId: t.String({ minLength: 1 }),
});

const selectActiveOrganizationResponseSchema = t.Object({
	organizationId: t.String({ minLength: 1 }),
});

export const createOrganizationRoutes = (auth: ClerkAuthPlugin) =>
	new Elysia({ name: "organization-routes" })
		.use(auth)
		.guard({ auth: true }, (app) =>
			app
				.get(
					"/orgs",
					async ({ authContext, db, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						if (!authContext.localUserId) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No local user found for current Clerk session",
								403,
							);
						}

						return {
							organizations: await listOrganizationsForUser(
								db,
								authContext.localUserId,
							),
						};
					},
					{
						detail: {
							tags: ["orgs"],
							summary: "Lists organizations the current user belongs to",
						},
						response: {
							200: organizationListResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.post(
					"/orgs",
					async ({ authContext, body, db, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						if (!authContext.localUserId) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No local user found for current Clerk session",
								403,
							);
						}

						const created = await createOrganization(db, {
							name: body.name,
							createdByLocalUserId: authContext.localUserId,
						});

						return { organization: created };
					},
					{
						body: createOrganizationBodySchema,
						detail: {
							tags: ["orgs"],
							summary:
								"Creates a new shared organization with the current user as owner",
						},
						response: {
							200: createOrganizationResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.post(
					"/orgs/:orgId/select-active",
					async ({ authContext, db, params, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						const selected = await selectActiveOrganizationForClerkUser(
							db,
							authContext.userId,
							params.orgId,
						);
						if (!selected) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_MEMBERSHIP_REQUIRED",
								"Selected organization must be a member organization",
								403,
							);
						}

						return { organizationId: selected.organizationId };
					},
					{
						params: t.Object({
							orgId: t.String({ minLength: 1 }),
						}),
						detail: {
							tags: ["orgs"],
							summary: "Select active organization for authenticated user",
						},
						response: {
							200: selectActiveOrganizationResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.get(
					"/orgs/:orgId/members",
					async ({ authContext, db, params, requestId, runtime, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						if (!authContext.localUserId) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No local user found for current Clerk session",
								403,
							);
						}

						const isMember = await ensureOrganizationMember(db, {
							organizationId: params.orgId,
							localUserId: authContext.localUserId,
						});
						if (!isMember) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_MEMBERSHIP_REQUIRED",
								"You must be a member of this organization",
								403,
							);
						}

						return {
							members: await listOrganizationMembers(db, params.orgId, runtime),
						};
					},
					{
						params: t.Object({
							orgId: t.String({ minLength: 1 }),
						}),
						detail: {
							tags: ["orgs"],
							summary: "Lists members of the specified organization",
						},
						response: {
							200: memberListResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.get(
					"/orgs/:orgId/invitations",
					async ({ authContext, db, params, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						if (!authContext.localUserId) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No local user found for current Clerk session",
								403,
							);
						}

						const isOwner = await ensureOrganizationOwner(db, {
							organizationId: params.orgId,
							localUserId: authContext.localUserId,
						});
						if (!isOwner) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_OWNER_REQUIRED",
								"Only owners can manage invitations",
								403,
							);
						}

						return {
							invitations: await listOrganizationInvitations(db, params.orgId),
						};
					},
					{
						params: t.Object({
							orgId: t.String({ minLength: 1 }),
						}),
						detail: {
							tags: ["orgs"],
							summary: "Lists invitations for an organization (owners only)",
						},
						response: {
							200: invitationListResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.post(
					"/orgs/:orgId/invitations",
					async ({ authContext, body, db, params, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						if (!authContext.localUserId) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No local user found for current Clerk session",
								403,
							);
						}

						const isOwner = await ensureOrganizationOwner(db, {
							organizationId: params.orgId,
							localUserId: authContext.localUserId,
						});
						if (!isOwner) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_OWNER_REQUIRED",
								"Only owners can create invitations",
								403,
							);
						}

						const invitation = await createOrganizationInvitation(db, {
							organizationId: params.orgId,
							email: body.email,
							role: body.role ?? "member",
							invitedBy: authContext.localUserId,
							...(body.ttlMs !== undefined ? { ttlMs: body.ttlMs } : {}),
						});

						return { invitation };
					},
					{
						params: t.Object({
							orgId: t.String({ minLength: 1 }),
						}),
						body: createInvitationBodySchema,
						detail: {
							tags: ["orgs"],
							summary: "Creates an invitation token for an organization",
						},
						response: {
							200: createdInvitationResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.post(
					"/orgs/:orgId/invitations/:invitationId/revoke",
					async ({ authContext, db, params, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						if (!authContext.localUserId) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No local user found for current Clerk session",
								403,
							);
						}

						const isOwner = await ensureOrganizationOwner(db, {
							organizationId: params.orgId,
							localUserId: authContext.localUserId,
						});
						if (!isOwner) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_OWNER_REQUIRED",
								"Only owners can revoke invitations",
								403,
							);
						}

						const revoked = await revokeOrganizationInvitation(
							db,
							params.invitationId,
						);
						if (!revoked) {
							set.status = 404;
							return createApiError(
								requestId,
								"INVITATION_NOT_FOUND",
								"Invitation not found or already finalized",
								404,
							);
						}

						return { invitation: revoked };
					},
					{
						params: t.Object({
							orgId: t.String({ minLength: 1 }),
							invitationId: t.String({ minLength: 1 }),
						}),
						detail: {
							tags: ["orgs"],
							summary: "Revokes a pending invitation",
						},
						response: {
							200: revokeResponseSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							404: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				)
				.post(
					"/orgs/invitations/accept",
					async ({ authContext, body, db, requestId, set }) => {
						if (!db) {
							set.status = 503;
							return createDbUnavailableError(requestId);
						}

						if (!authContext.localUserId) {
							set.status = 403;
							return createApiError(
								requestId,
								"ORG_CONTEXT_UNRESOLVED",
								"No local user found for current Clerk session",
								403,
							);
						}

						try {
							const result = await acceptInvitationByToken(db, {
								token: body.token,
								localUserId: authContext.localUserId,
							});
							return result;
						} catch (error) {
							set.status = 400;
							return createApiError(
								requestId,
								"INVITATION_NOT_ACCEPTABLE",
								error instanceof Error
									? error.message
									: "Unable to accept invitation",
								400,
							);
						}
					},
					{
						body: acceptInvitationBodySchema,
						detail: {
							tags: ["orgs"],
							summary: "Accepts a pending organization invitation by token",
						},
						response: {
							200: acceptInvitationResponseSchema,
							400: apiErrorSchema,
							401: apiErrorSchema,
							403: apiErrorSchema,
							500: apiErrorSchema,
							503: apiErrorSchema,
						},
					},
				),
		);
