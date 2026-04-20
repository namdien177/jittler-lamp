import { Elysia, t } from "elysia";

import { authContext } from "../middleware/auth-context";
import { selectActiveOrganizationForClerkUser } from "../services/active-organization";
import type { BackendDb } from "../services/user-provisioning";

export const organizationRoutes = new Elysia({ name: "organization-routes" })
	.use(authContext)
	.post(
		"/orgs/:orgId/select-active",
		async ({ authContext, params, set, store, ...ctx }) => {
			const requestId = (ctx as { requestId?: string }).requestId;
			if (!authContext.userId) {
				set.status = 401;
				return {
					error: {
						code: "AUTH_UNAUTHENTICATED",
						message: "Authentication required",
						status: 401,
						requestId: requestId ?? null,
					},
				};
			}

			const db = (store as { db?: BackendDb }).db;
			if (!db) {
				set.status = 500;
				return {
					error: {
						code: "DB_UNAVAILABLE",
						message: "Database is unavailable",
						status: 500,
						requestId: requestId ?? null,
					},
				};
			}

			const selected = await selectActiveOrganizationForClerkUser(
				db,
				authContext.userId,
				params.orgId,
			);
			if (!selected) {
				set.status = 403;
				return {
					error: {
						code: "ORG_MEMBERSHIP_REQUIRED",
						message: "Selected organization must be a member organization",
						status: 403,
						requestId: requestId ?? null,
					},
				};
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
		},
	);
