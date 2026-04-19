import { Elysia } from "elysia";

const getRequestId = (request: Request) =>
	request.headers.get("x-request-id") ?? crypto.randomUUID();

export const requestContext = new Elysia({ name: "request-context" })
	.onRequest(({ request, set }) => {
		set.headers["x-request-id"] = getRequestId(request);
	})
	.derive((context) => {
		const requestId =
			context.set.headers["x-request-id"] ?? getRequestId(context.request);
		const requestLogger = (
			context as unknown as { logger: { child: (meta: object) => unknown } }
		).logger.child({ requestId });

		return {
			requestId,
			logger: requestLogger,
		};
	});
