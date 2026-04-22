import { Elysia, t } from "elysia";

import {
	apiErrorSchema,
	createApiError,
	createDbUnavailableError,
} from "../http/api-error";
import type { ClerkAuthPlugin } from "../plugins/clerk-auth";
import { selectActiveOrganizationForClerkUser } from "../services/active-organization";

const selectActiveOrganizationResponseSchema = t.Object({
	organizationId: t.String({ minLength: 1 }),
});

export const createOrganizationRoutes = (auth: ClerkAuthPlugin) =>
	new Elysia({ name: "organization-routes" })
		.use(auth)
		.guard({ auth: true }, (app) =>
			app.post(
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

					return {
						organizationId: selected.organizationId,
					};
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
			),
		);
