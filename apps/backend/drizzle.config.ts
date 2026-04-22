import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!databaseUrl) {
	throw new Error("DATABASE_URL is required for Drizzle Kit commands");
}

const dbCredentials = databaseUrl.startsWith("libsql://")
	? (() => {
			if (!tursoAuthToken) {
				throw new Error(
					"TURSO_AUTH_TOKEN is required for remote libSQL/Turso URLs",
				);
			}

			return {
				url: databaseUrl,
				authToken: tursoAuthToken,
			};
		})()
	: {
			url: databaseUrl,
		};

export default defineConfig({
	dialect: "turso",
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dbCredentials,
	strict: true,
	verbose: true,
});
