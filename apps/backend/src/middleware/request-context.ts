import { Elysia } from "elysia";

export const requestContext = new Elysia({ name: "request-context" }).derive(
	(context) => {
		const { request, set } = context;
		const incomingRequestId = request.headers.get("x-request-id");
		const requestId = incomingRequestId ?? crypto.randomUUID();
		const requestLogger = (
			context as unknown as { logger: { child: (meta: object) => unknown } }
		).logger.child({ requestId });

		set.headers["x-request-id"] = requestId;

		return {
			requestId,
			logger: requestLogger,
		};
	},
);
