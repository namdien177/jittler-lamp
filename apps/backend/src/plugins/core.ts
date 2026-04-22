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

export const createCorePlugin = ({ runtime, db, logger }: CorePluginParams) =>
	new Elysia({ name: "backend-core" })
		.decorate({ runtime, db, logger })
		.onRequest(({ request, set, logger }) => {
			const requestId = getRequestId(request, set.headers["x-request-id"]);
			set.headers["x-request-id"] = requestId;

			logger.child({ requestId }).info(
				{
					method: request.method,
					path: new URL(request.url).pathname,
				},
				"request received",
			);
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
