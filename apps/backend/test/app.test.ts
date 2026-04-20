import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";

import { createApp } from "../src/app";
import { parseEnv } from "../src/config/env";
import { provisioningEvents } from "../src/db/schema";
import { createDb } from "../src/db";
import {
	ensureUserAndPersonalOrganization,
	retryFailedProvisioning,
} from "../src/services/user-provisioning";

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

	it("provisions one personal organization per user", async () => {
		const databaseUrl = `file:/tmp/jittle-lamp-${crypto.randomUUID()}.db`;
		const client = createClient({ url: databaseUrl });
		const migrationSql = readFileSync(
			new URL("../drizzle/0000_initial_identity.sql", import.meta.url),
			"utf8",
		);

		for (const statement of migrationSql
			.split("--> statement-breakpoint")
			.map((sql) => sql.trim())
			.filter(Boolean)) {
			await client.execute(statement);
		}

		const db = createDb(databaseUrl);
		expect(db).not.toBeNull();
		if (!db) {
			throw new Error("Database was not created");
		}

		const firstProvision = await ensureUserAndPersonalOrganization(db, {
			clerkUserId: "user_clerk_abc",
			source: "clerk-callback",
			rawPayload: { userId: "user_clerk_abc" },
		});
		const secondProvision = await ensureUserAndPersonalOrganization(db, {
			clerkUserId: "user_clerk_abc",
			source: "clerk-callback",
			rawPayload: { userId: "user_clerk_abc" },
		});

		expect(firstProvision.membershipRole).toBe("owner");
		expect(firstProvision.eventId).toBeString();
		expect(secondProvision.userId).toBe(firstProvision.userId);
		expect(secondProvision.organizationId).toBe(firstProvision.organizationId);
		expect(secondProvision.eventId).toBeNull();
	});

	it("only retries failed provisioning for the same Clerk user", async () => {
		const databaseUrl = `file:/tmp/jittle-lamp-${crypto.randomUUID()}.db`;
		const client = createClient({ url: databaseUrl });
		const migrationSql = readFileSync(
			new URL("../drizzle/0000_initial_identity.sql", import.meta.url),
			"utf8",
		);

		for (const statement of migrationSql
			.split("--> statement-breakpoint")
			.map((sql) => sql.trim())
			.filter(Boolean)) {
			await client.execute(statement);
		}

		const db = createDb(databaseUrl);
		expect(db).not.toBeNull();
		if (!db) {
			throw new Error("Database was not created");
		}

		const [failedEvent] = await db
			.insert(provisioningEvents)
			.values({
				clerkUserId: "user_clerk_owner",
				source: "clerk-callback",
				rawPayload: JSON.stringify({ userId: "user_clerk_owner" }),
				status: "failed",
				errorMessage: "simulated failure",
			})
			.returning({ id: provisioningEvents.id });

		if (!failedEvent) {
			throw new Error("Expected failed provisioning event to be created");
		}

		await expect(
			retryFailedProvisioning(
				db,
				failedEvent.id,
				"user_clerk_different_authenticated_user",
			),
		).rejects.toThrow(`No failed provisioning event found for ${failedEvent.id}`);
	});
});
