import pino from "pino";

export const createLogger = (level: pino.Level = "info") =>
	pino({
		level,
		timestamp: pino.stdTimeFunctions.isoTime,
		redact: ["req.headers.authorization", "secret", "password"],
	});
