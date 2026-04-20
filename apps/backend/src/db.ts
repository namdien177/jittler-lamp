import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./db/schema";

export const createDb = (databaseUrl?: string, authToken?: string) => {
	if (!databaseUrl) {
		return null;
	}

	const client = createClient(
		authToken ? { url: databaseUrl, authToken } : { url: databaseUrl },
	);

	return drizzle(client, { schema });
};
