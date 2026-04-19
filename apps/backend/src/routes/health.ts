import { Elysia } from "elysia";

export const healthRoutes = new Elysia({ name: "health-routes" })
	.get("/health", () => ({ status: "ok" }))
	.get("/version", ({ store }) => {
		const runtime = (store as { runtime: { version: string; nodeEnv: string } })
			.runtime;

		return {
			version: runtime.version,
			env: runtime.nodeEnv,
		};
	});
