import { Elysia, t } from "elysia";

import type { CorePlugin } from "../plugins/core";

const healthResponseSchema = t.Object({
	status: t.Literal("ok"),
});

const versionResponseSchema = t.Object({
	version: t.String({ minLength: 1 }),
	env: t.Union([
		t.Literal("local"),
		t.Literal("development"),
		t.Literal("staging"),
		t.Literal("production"),
	]),
});

export const createHealthRoutes = (core: CorePlugin) =>
	new Elysia({ name: "health-routes" })
		.use(core)
		.get("/health", () => ({ status: "ok" as const }), {
			detail: {
				tags: ["system"],
				summary: "Returns service health status",
			},
			response: {
				200: healthResponseSchema,
			},
		})
		.get(
			"/version",
			({ runtime }) => ({
				version: runtime.version,
				env: runtime.nodeEnv,
			}),
			{
				detail: {
					tags: ["system"],
					summary: "Returns backend version information",
				},
				response: {
					200: versionResponseSchema,
				},
			},
		);
