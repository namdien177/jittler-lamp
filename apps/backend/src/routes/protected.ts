import { Elysia } from "elysia";

import { authContext } from "../middleware/auth-context";

export const protectedRoutes = new Elysia({ name: "protected-routes" })
	.use(authContext)
	.get(
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
		},
	);
