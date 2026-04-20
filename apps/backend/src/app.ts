import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

import { parseEnv } from "./config/env";
import { buildRuntimeConfig } from "./config/runtime";
import { createDb } from "./db";
import { errorNormalizer } from "./middleware/error-normalizer";
import { requestContext } from "./middleware/request-context";
import { clerkProvisioningReplayRoute, clerkRoutes } from "./routes/clerk";
import { evidenceUploadRoutes } from "./routes/evidence-uploads";
import { healthRoutes } from "./routes/health";
import { protectedRoutes } from "./routes/protected";
import { createLogger } from "./utils/logger";

export const createApp = (source = process.env) => {
	const env = parseEnv(source);
	const runtime = buildRuntimeConfig(env);
	const logger = createLogger(runtime.logLevel);
	const db = createDb(runtime.databaseUrl, runtime.tursoAuthToken);

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
		.use(healthRoutes)
		.use(clerkRoutes)
		.use(clerkProvisioningReplayRoute)
		.use(evidenceUploadRoutes)
		.use(protectedRoutes);

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
