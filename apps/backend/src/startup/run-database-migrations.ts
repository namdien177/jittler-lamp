import { resolve } from "node:path";

import { migrate } from "drizzle-orm/libsql/migrator";
import type { Logger } from "pino";

import type { RuntimeConfig } from "../config/runtime";
import type { createDb } from "../db";

type BackendDb = NonNullable<ReturnType<typeof createDb>>;

export const runDatabaseMigrations = async ({
	db,
	runtime,
	logger,
}: {
	db: BackendDb | null;
	runtime: RuntimeConfig;
	logger: Logger;
}) => {
	if (!runtime.runDbMigrations) {
		return;
	}

	if (!runtime.databaseUrl || !db) {
		logger.info(
			"database migrations skipped because DATABASE_URL is not configured",
		);
		return;
	}

	const migrationsFolder = resolve(process.cwd(), "drizzle");
	logger.info({ migrationsFolder }, "applying database migrations");
	await migrate(db, { migrationsFolder });
	logger.info("database migrations applied");
};
