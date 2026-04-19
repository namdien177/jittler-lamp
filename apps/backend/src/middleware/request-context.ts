import { Elysia } from "elysia";

const getRequestId = (request: Request) =>
	request.headers.get("x-request-id") ?? crypto.randomUUID();

export const requestContext = new Elysia({ name: "request-context" })
	.onRequest(({ request, set }) => {
		set.headers["x-request-id"] = getRequestId(request);
	})
	.derive(({ request, set }) => {
		const requestId = set.headers["x-request-id"] ?? getRequestId(request);

		return {
			requestId,
		};
	});
