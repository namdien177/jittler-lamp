import { Elysia } from "elysia";

export const requestContext = new Elysia({ name: "request-context" })
	.derive(({ request, logger }) => {
		const incomingRequestId = request.headers.get("x-request-id");
		const requestId = incomingRequestId ?? crypto.randomUUID();
		const requestLogger = (
			logger as { child: (meta: object) => unknown }
		).child({ requestId });

		return {
			requestId,
			logger: requestLogger,
		};
	})
	.onAfterHandle(({ requestId, set }) => {
		set.headers["x-request-id"] = requestId;
	});
