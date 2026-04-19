import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export const createDb = (databaseUrl?: string) => {
	if (!databaseUrl) {
		return null;
	}

	const client = postgres(databaseUrl, { prepare: false });
	return drizzle(client);
};
