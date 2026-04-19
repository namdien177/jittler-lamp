import { Elysia } from "elysia";

export const requestContext = new Elysia({ name: "request-context" })
	.derive(({ request, store }) => {
		const incomingRequestId = request.headers.get("x-request-id");
		const requestId = incomingRequestId ?? crypto.randomUUID();
		const logger = (
			store as { logger: { child: (meta: object) => unknown } }
		).logger.child({ requestId });

		return {
			requestId,
			logger,
		};
	})
	.onAfterHandle(({ requestId, set }) => {
		set.headers["x-request-id"] = requestId;
	});
