import type { AppEnv, NodeEnv } from "./env";

const defaultsByEnv: Record<
	NodeEnv,
	{ logLevel: AppEnv["LOG_LEVEL"]; enableSwagger: boolean }
> = {
	local: { logLevel: "debug", enableSwagger: true },
	development: { logLevel: "debug", enableSwagger: true },
	staging: { logLevel: "info", enableSwagger: false },
	production: { logLevel: "info", enableSwagger: false },
};

export type RuntimeConfig = {
	host: string;
	port: number;
	version: string;
	nodeEnv: NodeEnv;
	secret: string | undefined;
	databaseUrl: string | undefined;
	logLevel: Exclude<NonNullable<AppEnv["LOG_LEVEL"]>, "silent">;
	enableSwagger: boolean;
	clerkSecretKey: string | undefined;
	clerkJwtKey: string | undefined;
	clerkAudience: string | undefined;
	clerkAuthorizedParties: string[] | undefined;
};

const parseAuthorizedParties = (
	authorizedParties: string | undefined,
): string[] | undefined => {
	if (!authorizedParties) {
		return undefined;
	}

	const parsed = authorizedParties
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);

	return parsed.length > 0 ? parsed : undefined;
};

export const buildRuntimeConfig = (env: AppEnv): RuntimeConfig => {
	const defaults = defaultsByEnv[env.NODE_ENV];
	const resolvedLogLevel = env.LOG_LEVEL ?? defaults.logLevel ?? "info";

	return {
		host: env.HOST,
		port: env.PORT,
		version: env.APP_VERSION,
		nodeEnv: env.NODE_ENV,
		secret: env.APP_SECRET,
		databaseUrl: env.DATABASE_URL,
		logLevel: resolvedLogLevel === "silent" ? "info" : resolvedLogLevel,
		enableSwagger: defaults.enableSwagger,
		clerkSecretKey: env.CLERK_SECRET_KEY,
		clerkJwtKey: env.CLERK_JWT_KEY,
		clerkAudience: env.CLERK_AUDIENCE,
		clerkAuthorizedParties: parseAuthorizedParties(
			env.CLERK_AUTHORIZED_PARTIES,
		),
	};
};
