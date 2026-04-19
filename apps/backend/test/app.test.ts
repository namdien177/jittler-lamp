import { describe, expect, it } from "bun:test";

import { createApp } from "../src/app";
import { parseEnv } from "../src/config/env";

describe("env validation", () => {
	it("requires APP_SECRET in production", () => {
		expect(() =>
			parseEnv({
				NODE_ENV: "production",
				PORT: "3001",
				HOST: "127.0.0.1",
				APP_VERSION: "1.0.0",
			}),
		).toThrow();
	});

	it("accepts local env without APP_SECRET", () => {
		expect(() =>
			parseEnv({
				NODE_ENV: "local",
				PORT: "3001",
				HOST: "127.0.0.1",
				APP_VERSION: "1.0.0",
			}),
		).not.toThrow();
	});
});

describe("health routes", () => {
	it("returns version payload", async () => {
		const { app } = createApp({
			NODE_ENV: "development",
			APP_VERSION: "9.9.9",
			APP_SECRET: "123456789012345678901234",
		});

		const response = await app.handle(new Request("http://localhost/version"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			version: "9.9.9",
			env: "development",
		});
	});
});
