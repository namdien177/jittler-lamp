import { Elysia } from "elysia";
import type { Logger } from "pino";

import type { RuntimeConfig } from "../config/runtime";
import { createApiError } from "../http/api-error";
import type { BackendDb } from "../services/user-provisioning";

type CorePluginParams = {
	runtime: RuntimeConfig;
	db: BackendDb | null;
	logger: Logger;
};

const getRequestId = (
	request: Request,
	responseHeaderValue?: string | string[],
) => {
	if (
		typeof responseHeaderValue === "string" &&
		responseHeaderValue.length > 0
	) {
		return responseHeaderValue;
	}

	return request.headers.get("x-request-id") ?? crypto.randomUUID();
};

const localWebOrigins = new Set([
	"http://127.0.0.1:4173",
	"http://localhost:4173",
]);

const isDevelopmentRuntime = (runtime: RuntimeConfig) =>
	runtime.nodeEnv === "local" || runtime.nodeEnv === "development";

const isAllowedCorsOrigin = (runtime: RuntimeConfig, origin: string) => {
	if (runtime.webAppOrigin === origin) {
		return true;
	}

	return isDevelopmentRuntime(runtime) && localWebOrigins.has(origin);
};

const applyCorsHeaders = (
	request: Request,
	set: { headers: Record<string, string | string[] | number> },
	runtime: RuntimeConfig,
) => {
	const origin = request.headers.get("origin");
	if (!origin || !isAllowedCorsOrigin(runtime, origin)) {
		return;
	}

	set.headers["access-control-allow-origin"] = origin;
	set.headers["access-control-allow-methods"] =
		"GET,POST,PUT,PATCH,DELETE,OPTIONS";
	set.headers["access-control-allow-headers"] =
		"authorization,content-type,x-request-id";
	set.headers["access-control-max-age"] = "600";
	set.headers.vary = "Origin";
};

export const createCorePlugin = ({ runtime, db, logger }: CorePluginParams) =>
	new Elysia({ name: "backend-core" })
		.decorate({ runtime, db, logger })
		.onRequest(({ request, set, logger, runtime }) => {
			const requestId = getRequestId(request, set.headers["x-request-id"]);
			set.headers["x-request-id"] = requestId;
			applyCorsHeaders(request, set, runtime);

			logger.child({ requestId }).info(
				{
					method: request.method,
					path: new URL(request.url).pathname,
				},
				"request received",
			);

			if (
				request.method === "OPTIONS" &&
				request.headers.has("access-control-request-method")
			) {
				set.status = 204;
				return "";
			}
		})
		.resolve({ as: "global" }, ({ request, set, logger }) => {
			const requestId = getRequestId(request, set.headers["x-request-id"]);

			return {
				requestId,
				requestLogger: logger.child({ requestId }),
			};
		})
		.onError(({ code, error, logger, request, set }) => {
			const requestId = getRequestId(request, set.headers["x-request-id"]);
			const requestLogger = logger.child({ requestId });
			const status =
				set.status && Number(set.status) >= 400
					? Number(set.status)
					: code === "VALIDATION"
						? 400
						: 500;

			requestLogger.error({ err: error, code, status }, "request failed");
			set.status = status;

			return createApiError(
				requestId,
				String(code),
				error instanceof Error ? error.message : "Unexpected error",
				status,
			);
		});

export type CorePlugin = ReturnType<typeof createCorePlugin>;
