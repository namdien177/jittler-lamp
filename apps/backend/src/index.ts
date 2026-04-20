import { createApp } from "./app";
import { runDatabaseMigrations } from "./startup/run-database-migrations";

const { app, runtime, logger, db } = createApp(process.env);

try {
	await runDatabaseMigrations({ db, runtime, logger });
	app.listen({ hostname: runtime.host, port: runtime.port }, () => {
		logger.info(
			{ host: runtime.host, port: runtime.port, env: runtime.nodeEnv },
			"backend listening",
		);
	});
} catch (error) {
	logger.error(
		{ err: error, databaseUrlConfigured: Boolean(runtime.databaseUrl) },
		"failed to apply database migrations",
	);
	process.exit(1);
}
