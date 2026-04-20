import { verifyToken } from "@clerk/backend";
import { Elysia } from "elysia";

import type { RuntimeConfig } from "../config/runtime";
import type { BackendDb } from "../services/user-provisioning";
import { resolveActiveOrganizationForClerkUser } from "../services/active-organization";
import { ensureUserAndPersonalOrganization } from "../services/user-provisioning";

export type RoutePolicy = "public" | "protected";

export type AuthContext = {
	isAuthenticated: boolean;
	userId: string | null;
	orgId: string | null;
	activeOrgId: string | null;
	roles: string[];
	scopes: string[];
};

type RoutePolicyRule = {
	path: string;
	policy: RoutePolicy;
	match: "exact" | "prefix";
};

const authContextKey = Symbol("auth-context");

const defaultAuthContext: AuthContext = {
	isAuthenticated: false,
	userId: null,
	orgId: null,
	activeOrgId: null,
	roles: [],
	scopes: [],
};

const routePolicyMap: RoutePolicyRule[] = [
	{ path: "/health", policy: "public", match: "exact" },
	{ path: "/version", policy: "public", match: "exact" },
	{ path: "/docs", policy: "public", match: "prefix" },
	{ path: "/swagger", policy: "public", match: "prefix" },
	{ path: "/protected", policy: "protected", match: "prefix" },
	{ path: "/evidences", policy: "protected", match: "prefix" },
	{ path: "/orgs", policy: "protected", match: "prefix" },
];

const resolveRoutePolicy = (pathname: string): RoutePolicy => {
	for (const rule of routePolicyMap) {
		if (rule.match === "exact" && pathname === rule.path) {
			return rule.policy;
		}

		if (rule.match === "prefix" && pathname.startsWith(rule.path)) {
			return rule.policy;
		}
	}

	return "public";
};

const readToken = (request: Request): string | null => {
	const authHeader = request.headers.get("authorization");
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice("Bearer ".length).trim();
	}

	const cookieHeader = request.headers.get("cookie");
	if (!cookieHeader) {
		return null;
	}

	const sessionCookie = cookieHeader
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith("__session="));

	if (!sessionCookie) {
		return null;
	}

	return decodeURIComponent(sessionCookie.slice("__session=".length));
};

const claimsToAuthContext = (claims: Record<string, unknown>): AuthContext => {
	const scopeClaim = typeof claims.scope === "string" ? claims.scope : "";
	const scopes = scopeClaim
		.split(" ")
		.map((scope) => scope.trim())
		.filter(Boolean);

	const roles = Array.isArray(claims.roles)
		? claims.roles.filter((role): role is string => typeof role === "string")
		: [];

	return {
		isAuthenticated: true,
		userId: typeof claims.sub === "string" ? claims.sub : null,
		orgId: typeof claims.org_id === "string" ? claims.org_id : null,
		activeOrgId: null,
		roles,
		scopes,
	};
};

const setRequestAuthContext = (request: Request, authContext: AuthContext) => {
	(request as Request & { [authContextKey]?: AuthContext })[authContextKey] =
		authContext;
};

const getRequestAuthContext = (request: Request): AuthContext =>
	(request as Request & { [authContextKey]?: AuthContext })[authContextKey] ??
	defaultAuthContext;

const unauthorized = (
	requestId: string | undefined,
	code: string,
	message: string,
	status: 401 | 403,
) => ({
	error: {
		code,
		message,
		status,
		requestId: requestId ?? null,
	},
});

const isAuthConfigured = (runtime: RuntimeConfig) =>
	Boolean(runtime.clerkSecretKey || runtime.clerkJwtKey);

export const authContext = new Elysia({ name: "auth-context" })
	.onRequest(async (ctx) => {
		setRequestAuthContext(ctx.request, defaultAuthContext);
		const runtime = (ctx.store as { runtime: RuntimeConfig }).runtime;
		const policy = resolveRoutePolicy(new URL(ctx.request.url).pathname);
		const token = readToken(ctx.request);
		const requestId = (ctx as { requestId?: string }).requestId;

		if (!token) {
			if (policy === "protected") {
				ctx.set.status = 401;
				return unauthorized(
					requestId,
					"AUTH_UNAUTHENTICATED",
					"Authentication required",
					401,
				);
			}

			return;
		}

		if (!isAuthConfigured(runtime)) {
			ctx.set.status = 500;
			return {
				error: {
					code: "AUTH_MISCONFIGURED",
					message: "Clerk backend auth configuration is missing",
					status: 500,
					requestId: requestId ?? null,
				},
			};
		}

		let resolvedAuthContext = defaultAuthContext;
		try {
			const claims = (await verifyToken(token, {
				secretKey: runtime.clerkSecretKey,
				jwtKey: runtime.clerkJwtKey,
				audience: runtime.clerkAudience,
				authorizedParties: runtime.clerkAuthorizedParties,
			})) as Record<string, unknown>;
			resolvedAuthContext = claimsToAuthContext(claims);
			setRequestAuthContext(ctx.request, resolvedAuthContext);
		} catch {
			ctx.set.status = 401;
			return unauthorized(
				requestId,
				"AUTH_INVALID_TOKEN",
				"Invalid or expired auth token",
				401,
			);
		}

		try {
			const db = (ctx.store as { db: unknown }).db;
			if (db && resolvedAuthContext.userId) {
				await ensureUserAndPersonalOrganization(db as BackendDb, {
					clerkUserId: resolvedAuthContext.userId,
					source: "auth-middleware",
					rawPayload: {
						userId: resolvedAuthContext.userId,
						orgId: resolvedAuthContext.orgId,
						roles: resolvedAuthContext.roles,
						scopes: resolvedAuthContext.scopes,
					},
				});
				const activeOrganization = await resolveActiveOrganizationForClerkUser(
					db as BackendDb,
					resolvedAuthContext.userId,
				);
				resolvedAuthContext = {
					...resolvedAuthContext,
					activeOrgId: activeOrganization?.organizationId ?? null,
				};
				setRequestAuthContext(ctx.request, resolvedAuthContext);
			}
		} catch {
			ctx.set.status = 500;
			return {
				error: {
					code: "AUTH_PROVISIONING_FAILED",
					message: "Failed to provision local user workspace",
					status: 500,
					requestId: requestId ?? null,
				},
			};
		}

		if (policy === "protected" && !getRequestAuthContext(ctx.request).userId) {
			ctx.set.status = 403;
			return unauthorized(requestId, "AUTH_FORBIDDEN", "Forbidden", 403);
		}
	})
	.derive({ as: "global" }, ({ request }) => ({
		authContext: getRequestAuthContext(request),
	}));
