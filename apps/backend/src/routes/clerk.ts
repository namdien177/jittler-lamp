import { Elysia } from "elysia";

import { authContext } from "../middleware/auth-context";
import type { BackendDb } from "../services/user-provisioning";
import {
	ensureUserAndPersonalOrganization,
	retryFailedProvisioning,
} from "../services/user-provisioning";

export const clerkRoutes = new Elysia({ name: "clerk-routes" })
	.use(authContext)
	.post(
		"/clerk/callback",
		async ({ authContext, store, set }) => {
			const state = store as { db: BackendDb | null };

			if (!authContext.userId) {
				set.status = 401;
				return {
					error: {
						code: "AUTH_UNAUTHENTICATED",
						message: "Authentication required",
						status: 401,
					},
				};
			}

			if (!state.db) {
				set.status = 503;
				return {
					error: {
						code: "DB_NOT_CONFIGURED",
						message:
							"DATABASE_URL is not configured. Cannot provision user workspace.",
						status: 503,
					},
				};
			}

			const provisioned = await ensureUserAndPersonalOrganization(state.db, {
				clerkUserId: authContext.userId,
				source: "clerk-callback",
				rawPayload: {
					userId: authContext.userId,
					orgId: authContext.orgId,
					roles: authContext.roles,
					scopes: authContext.scopes,
				},
			});

			return {
				ok: true,
				provisioned,
			};
		},
		{
			detail: {
				tags: ["clerk"],
				summary:
					"Clerk callback hook for ensuring local user + personal organization",
			},
		},
	);

export const clerkProvisioningReplayRoute = new Elysia({
	name: "clerk-provisioning-replay-route",
})
	.use(authContext)
	.post(
		"/clerk/callback/retry/:eventId",
		async ({ authContext, params, store, set }) => {
			const state = store as { db: BackendDb | null };

			if (!authContext.userId) {
				set.status = 401;
				return {
					error: {
						code: "AUTH_UNAUTHENTICATED",
						message: "Authentication required",
						status: 401,
					},
				};
			}

			if (!state.db) {
				set.status = 503;
				return {
					error: {
						code: "DB_NOT_CONFIGURED",
						message:
							"DATABASE_URL is not configured. Cannot retry provisioning.",
						status: 503,
					},
				};
			}

			try {
				const provisioned = await retryFailedProvisioning(
					state.db,
					params.eventId,
					authContext.userId,
				);
				return { ok: true, provisioned };
			} catch (error) {
				set.status = 400;
				return {
					error: {
						code: "PROVISIONING_RETRY_FAILED",
						message: error instanceof Error ? error.message : "Retry failed",
						status: 400,
					},
				};
			}
		},
		{
			detail: {
				tags: ["clerk"],
				summary:
					"Replay a failed provisioning event for a Clerk-authenticated user",
			},
		},
	);
