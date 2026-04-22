import { z } from "zod";

export const nodeEnvSchema = z.enum([
	"local",
	"development",
	"staging",
	"production",
]);
export type NodeEnv = z.infer<typeof nodeEnvSchema>;

const envSchema = z
	.object({
		NODE_ENV: nodeEnvSchema.default("local"),
		PORT: z.coerce.number().int().min(1).max(65535).default(3001),
		HOST: z.string().default("0.0.0.0"),
		APP_VERSION: z.string().default("0.1.3"),
		APP_SECRET: z.string().min(24).optional(),
		DATABASE_URL: z.string().url().optional(),
		RUN_DB_MIGRATIONS: z.string().optional(),
		TURSO_AUTH_TOKEN: z.string().min(1).optional(),
		LOG_LEVEL: z
			.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
			.optional(),
		CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
		CLERK_SECRET_KEY: z.string().min(1).optional(),
		CLERK_JWT_KEY: z.string().min(1).optional(),
		CLERK_AUDIENCE: z.string().min(1).optional(),
		CLERK_AUTHORIZED_PARTIES: z.string().min(1).optional(),
	})
	.superRefine((env, ctx) => {
		if (env.NODE_ENV === "production" && !env.APP_SECRET) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["APP_SECRET"],
				message: "APP_SECRET is required in production",
			});
		}

		if (env.DATABASE_URL?.startsWith("libsql://") && !env.TURSO_AUTH_TOKEN) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["TURSO_AUTH_TOKEN"],
				message: "TURSO_AUTH_TOKEN is required for remote libSQL/Turso URLs",
			});
		}

		const clerkConfigured = Boolean(
			env.CLERK_PUBLISHABLE_KEY || env.CLERK_SECRET_KEY || env.CLERK_JWT_KEY,
		);
		if (!clerkConfigured) {
			return;
		}

		if (!env.CLERK_SECRET_KEY && !env.CLERK_JWT_KEY) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["CLERK_SECRET_KEY"],
				message:
					"CLERK_SECRET_KEY or CLERK_JWT_KEY is required when Clerk auth is configured",
			});
		}

		if (env.NODE_ENV === "staging" || env.NODE_ENV === "production") {
			if (!env.CLERK_PUBLISHABLE_KEY) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["CLERK_PUBLISHABLE_KEY"],
					message:
						"CLERK_PUBLISHABLE_KEY is required in staging/production when Clerk auth is enabled",
				});
			}

			if (!env.CLERK_AUTHORIZED_PARTIES) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["CLERK_AUTHORIZED_PARTIES"],
					message:
						"CLERK_AUTHORIZED_PARTIES is required in staging/production when Clerk auth is enabled",
				});
			}
		}
	});

export type AppEnv = z.infer<typeof envSchema>;

export const parseEnv = (source: Record<string, string | undefined>): AppEnv =>
	envSchema.parse(source);
