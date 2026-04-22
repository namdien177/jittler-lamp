import { Elysia, t } from "elysia";

import { apiErrorSchema } from "../http/api-error";
import type { ClerkAuthPlugin } from "../plugins/clerk-auth";

const protectedMeResponseSchema = t.Object({
	userId: t.String({ minLength: 1 }),
	orgId: t.Union([t.String({ minLength: 1 }), t.Null()]),
	activeOrgId: t.Union([t.String({ minLength: 1 }), t.Null()]),
	roles: t.Array(t.String({ minLength: 1 })),
	scopes: t.Array(t.String({ minLength: 1 })),
});

export const createProtectedRoutes = (auth: ClerkAuthPlugin) =>
	new Elysia({ name: "protected-routes" })
		.use(auth)
		.guard({ auth: true }, (app) =>
			app.get(
				"/protected/me",
				({ authContext }) => ({
					userId: authContext.userId,
					orgId: authContext.orgId,
					activeOrgId: authContext.activeOrgId,
					roles: authContext.roles,
					scopes: authContext.scopes,
				}),
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
