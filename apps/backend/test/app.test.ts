import { describe, expect, it } from "bun:test";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";

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

describe("routes", () => {
	it("emits x-request-id header on 404 responses", async () => {
		const { app } = createApp({
			NODE_ENV: "development",
			APP_VERSION: "9.9.9",
			APP_SECRET: "123456789012345678901234",
		});

		const response = await app.handle(
			new Request("http://localhost/does-not-exist"),
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("x-request-id")).toBeString();
	});

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

	it("blocks protected routes without an auth token", async () => {
		const { app } = createApp({
			NODE_ENV: "development",
			APP_VERSION: "9.9.9",
			APP_SECRET: "123456789012345678901234",
		});

		const response = await app.handle(
			new Request("http://localhost/protected/me"),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: {
				code: "AUTH_UNAUTHENTICATED",
				message: "Authentication required",
				status: 401,
				requestId: null,
			},
		});
	});

	it("injects auth context for authenticated requests", async () => {
		const { privateKey, publicKey } = await generateKeyPair("RS256");
		const jwtKey = await exportSPKI(publicKey);
		const token = await new SignJWT({ org_id: "org_123", scope: "read write" })
			.setProtectedHeader({ alg: "RS256" })
			.setSubject("user_123")
			.setAudience("test-audience")
			.setIssuedAt()
			.setExpirationTime("5m")
			.sign(privateKey);

		const { app } = createApp({
			NODE_ENV: "development",
			APP_VERSION: "9.9.9",
			APP_SECRET: "123456789012345678901234",
			CLERK_JWT_KEY: jwtKey,
			CLERK_AUDIENCE: "test-audience",
		});

		const response = await app.handle(
			new Request("http://localhost/protected/me", {
				headers: { authorization: `Bearer ${token}` },
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			userId: "user_123",
			orgId: "org_123",
			roles: [],
			scopes: ["read", "write"],
		});
	});
});
