import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";

import { createApp } from "../src/app";
import { parseEnv } from "../src/config/env";
import { createDb } from "../src/db";
import {
	evidenceArtifacts,
	evidences,
	organizationMembers,
	organizations,
	provisioningEvents,
} from "../src/db/schema";
import {
	ensureUserAndPersonalOrganization,
	retryFailedProvisioning,
} from "../src/services/user-provisioning";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const applyMigrations = async (databaseUrl: string) => {
	const db = createDb(databaseUrl);
	if (!db) {
		throw new Error("Database was not created");
	}

	await migrate(db, { migrationsFolder });
};

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


	it("rejects client-provided orgId when starting uploads", async () => {
		const databaseUrl = `file:/tmp/jittle-lamp-${crypto.randomUUID()}.db`;
		await applyMigrations(databaseUrl);

		const db = createDb(databaseUrl);
		expect(db).not.toBeNull();
		if (!db) {
			throw new Error("Database was not created");
		}

		const provisioned = await ensureUserAndPersonalOrganization(db, {
			clerkUserId: "user_clerk_uploads_reject_orgid",
			source: "clerk-callback",
			rawPayload: { userId: "user_clerk_uploads_reject_orgid" },
		});

		const { privateKey, publicKey } = await generateKeyPair("RS256");
		const jwtKey = await exportSPKI(publicKey);
		const token = await new SignJWT({ org_id: provisioned.organizationId })
			.setProtectedHeader({ alg: "RS256" })
			.setSubject("user_clerk_uploads_reject_orgid")
			.setAudience("test-audience")
			.setIssuedAt()
			.setExpirationTime("5m")
			.sign(privateKey);

		const { app } = createApp({
			NODE_ENV: "development",
			DATABASE_URL: databaseUrl,
			APP_VERSION: "9.9.9",
			APP_SECRET: "123456789012345678901234",
			CLERK_JWT_KEY: jwtKey,
			CLERK_AUDIENCE: "test-audience",
		});

		const response = await app.handle(
			new Request("http://localhost/evidences/uploads/start", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					title: "Upload draft",
					sourceType: "browser",
					orgId: crypto.randomUUID(),
					artifact: {
						kind: "recording",
						mimeType: "video/webm",
						bytes: 128,
						checksum: "sha256:abc",
					},
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: {
				code: "EVIDENCE_UPLOAD_CLIENT_ORG_FORBIDDEN",
				message: "Client-provided orgId is not allowed",
				status: 400,
				requestId: null,
			},
		});
	});

	it("scopes upload lifecycle to the active organization", async () => {
		const databaseUrl = `file:/tmp/jittle-lamp-${crypto.randomUUID()}.db`;
		await applyMigrations(databaseUrl);

		const db = createDb(databaseUrl);
		expect(db).not.toBeNull();
		if (!db) {
			throw new Error("Database was not created");
		}

		const provisioned = await ensureUserAndPersonalOrganization(db, {
			clerkUserId: "user_clerk_uploads_scope",
			source: "clerk-callback",
			rawPayload: { userId: "user_clerk_uploads_scope" },
		});

		const [teamOrganization] = await db
			.insert(organizations)
			.values({
				name: "Team Uploads",
				isPersonal: false,
				personalOwnerUserId: null,
			})
			.returning({ id: organizations.id });

		if (!teamOrganization) {
			throw new Error("Team organization was not created");
		}

		await db.insert(organizationMembers).values({
			organizationId: teamOrganization.id,
			userId: provisioned.userId,
			role: "member",
		});

		const { privateKey, publicKey } = await generateKeyPair("RS256");
		const jwtKey = await exportSPKI(publicKey);
		const token = await new SignJWT({ org_id: teamOrganization.id })
			.setProtectedHeader({ alg: "RS256" })
			.setSubject("user_clerk_uploads_scope")
			.setAudience("test-audience")
			.setIssuedAt()
			.setExpirationTime("5m")
			.sign(privateKey);

		const { app } = createApp({
			NODE_ENV: "development",
			DATABASE_URL: databaseUrl,
			APP_VERSION: "9.9.9",
			APP_SECRET: "123456789012345678901234",
			CLERK_JWT_KEY: jwtKey,
			CLERK_AUDIENCE: "test-audience",
		});

		const startResponse = await app.handle(
			new Request("http://localhost/evidences/uploads/start", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					title: "Team upload draft",
					sourceType: "browser",
					artifact: {
						kind: "recording",
						mimeType: "video/webm",
						bytes: 256,
						checksum: "sha256:def",
					},
				}),
			}),
		);

		expect(startResponse.status).toBe(200);
		const startPayload = (await startResponse.json()) as {
			uploadId: string;
			evidenceId: string;
			organizationId: string;
		};
		expect(startPayload.organizationId).toBe(teamOrganization.id);

		const createdEvidence = await db.query.evidences.findFirst({
			where: eq(evidences.id, startPayload.evidenceId),
			columns: { orgId: true, createdBy: true },
		});
		expect(createdEvidence?.orgId).toBe(teamOrganization.id);
		expect(createdEvidence?.createdBy).toBe(provisioned.userId);

		const completeResponse = await app.handle(
			new Request(
				`http://localhost/evidences/uploads/${startPayload.uploadId}/complete`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						bytes: 256,
						checksum: "sha256:def",
						mimeType: "video/webm",
					}),
				},
			),
		);

		expect(completeResponse.status).toBe(200);
		expect(await completeResponse.json()).toEqual({
			uploadId: startPayload.uploadId,
			evidenceId: startPayload.evidenceId,
			status: "committed",
		});

		const storedArtifact = await db.query.evidenceArtifacts.findFirst({
			where: eq(evidenceArtifacts.id, startPayload.uploadId),
			columns: { uploadStatus: true },
		});
		expect(storedArtifact?.uploadStatus).toBe("uploaded");
	});

	it("provisions one personal organization per user", async () => {
		const databaseUrl = `file:/tmp/jittle-lamp-${crypto.randomUUID()}.db`;
		await applyMigrations(databaseUrl);

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
		await applyMigrations(databaseUrl);

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
		).rejects.toThrow(
			`No failed provisioning event found for ${failedEvent.id}`,
		);
	});
});
