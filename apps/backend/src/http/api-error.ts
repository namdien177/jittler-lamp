import { t } from "elysia";

export const apiErrorDetailSchema = t.Object({
	code: t.String({ minLength: 1 }),
	message: t.String({ minLength: 1 }),
	status: t.Number({ minimum: 400, maximum: 599 }),
	requestId: t.Union([t.String({ minLength: 1 }), t.Null()]),
});

export const apiErrorSchema = t.Object({
	error: apiErrorDetailSchema,
});

export const createApiError = (
	requestId: string | null | undefined,
	code: string,
	message: string,
	status: number,
) => ({
	error: {
		code,
		message,
		status,
		requestId: requestId ?? null,
	},
});

export const createDbUnavailableError = (
	requestId: string | null | undefined,
	message = "Database is unavailable",
) => createApiError(requestId, "DB_UNAVAILABLE", message, 503);
