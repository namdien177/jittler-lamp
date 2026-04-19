import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

import { parseEnv } from "./config/env";
import { buildRuntimeConfig } from "./config/runtime";
import { createDb } from "./db";
import { errorNormalizer } from "./middleware/error-normalizer";
import { requestContext } from "./middleware/request-context";
import { healthRoutes } from "./routes/health";
import { createLogger } from "./utils/logger";

export const createApp = (source = process.env) => {
	const env = parseEnv(source);
	const runtime = buildRuntimeConfig(env);
	const logger = createLogger(runtime.logLevel);
	const db = createDb(runtime.databaseUrl);

	const app = new Elysia({ aot: false })
		.decorate("logger", logger)
		.state({ runtime, db })
		.use(requestContext)
		.use(errorNormalizer)
		.onRequest(({ request, logger: requestLogger }) => {
			requestLogger.info(
				{
					method: request.method,
					path: new URL(request.url).pathname,
				},
				"request received",
			);
		})
		.use(healthRoutes);

	if (runtime.enableSwagger) {
		app.use(
			swagger({
				documentation: {
					info: {
						title: "Jittle Lamp Backend API",
						version: runtime.version,
					},
				},
				path: "/docs",
			}),
		);
	}

	return { app, runtime, logger };
};
