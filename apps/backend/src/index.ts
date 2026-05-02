import { createApp } from "./app";
import { cleanupExpiredGuestMemberships } from "./services/organization-management";
import { runDatabaseMigrations } from "./startup/run-database-migrations";

const { app, runtime, logger, db } = createApp(process.env);

try {
	await runDatabaseMigrations({ db, runtime, logger });
	if (db) {
		const runGuestCleanup = async () => {
			try {
				const removed = await cleanupExpiredGuestMemberships(db);
				if (removed > 0) {
					logger.info(
						{ removed },
						"expired guest organization memberships cleaned up",
					);
				}
			} catch (err) {
				logger.error(
					{ err },
					"failed to clean up expired guest organization memberships",
				);
			}
		};
		setInterval(() => void runGuestCleanup(), 60 * 60 * 1000).unref();
		void runGuestCleanup();
	}
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
