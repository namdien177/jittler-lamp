import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!databaseUrl) {
	throw new Error("DATABASE_URL is required for Drizzle Kit commands");
}

export default defineConfig({
	dialect: "turso",
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dbCredentials: {
		url: databaseUrl,
		authToken: tursoAuthToken,
	},
	strict: true,
	verbose: true,
});
