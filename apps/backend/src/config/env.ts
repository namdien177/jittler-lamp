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
		LOG_LEVEL: z
			.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
			.optional(),
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
	});

export type AppEnv = z.infer<typeof envSchema>;

export const parseEnv = (source: Record<string, string | undefined>): AppEnv =>
	envSchema.parse(source);
