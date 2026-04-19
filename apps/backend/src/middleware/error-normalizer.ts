import { Elysia } from "elysia";

export const errorNormalizer = new Elysia({ name: "error-normalizer" }).onError(
	(ctx) => {
		const { code, error, set } = ctx;
		const requestId = (ctx as { requestId?: string }).requestId;
		const logger = (
			ctx as { logger?: { error: (payload: object, message: string) => void } }
		).logger;
		const status =
			set.status && Number(set.status) >= 400
				? Number(set.status)
				: code === "VALIDATION"
					? 400
					: 500;

		logger?.error({ err: error, code, status }, "request failed");
		set.status = status;

		return {
			error: {
				code,
				message: error instanceof Error ? error.message : "Unexpected error",
				status,
				requestId,
			},
		};
	},
);
