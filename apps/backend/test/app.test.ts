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

const sha256Hex = async (value: string): Promise<string> => {
	const payload = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", payload);
	return Array.from(new Uint8Array(digest))
		.map((part) => part.toString(16).padStart(2, "0"))
		.join("");
};

type AuthFixture = {
	privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
	jwtKey: string;
};

let authFixturePromise: Promise<AuthFixture> | null = null;
const getAuthFixture = async (): Promise<AuthFixture> => {
	if (!authFixturePromise) {
		authFixturePromise = (async () => {
			const { privateKey, publicKey } = await generateKeyPair("RS256");
			return {
				privateKey,
				jwtKey: await exportSPKI(publicKey),
			};
		})();
	}

	return authFixturePromise;
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
		const { privateKey, jwtKey } = await getAuthFixture();
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

		await ensureUserAndPersonalOrganization(db, {
			clerkUserId: "user_clerk_uploads_reject_orgid",
			source: "clerk-callback",
			rawPayload: { userId: "user_clerk_uploads_reject_orgid" },
		});

		const { privateKey, jwtKey } = await getAuthFixture();
		const token = await new SignJWT({ scope: "read write" })
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

		const { privateKey, jwtKey } = await getAuthFixture();
		const token = await new SignJWT({ scope: "read write" })
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
						bytes: 11,
						checksum: `sha256:${await sha256Hex("hello world")}`,
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
		expect(startPayload.organizationId).toBe(provisioned.organizationId);

		const createdEvidence = await db.query.evidences.findFirst({
			where: eq(evidences.id, startPayload.evidenceId),
			columns: { orgId: true, createdBy: true },
		});
		expect(createdEvidence?.orgId).toBe(provisioned.organizationId);
		expect(createdEvidence?.createdBy).toBe(provisioned.userId);

		const blobResponse = await app.handle(
			new Request(
				`http://localhost/evidences/uploads/${startPayload.uploadId}/blob`,
				{
					method: "PUT",
					headers: {
						"content-type": "video/webm",
						authorization: `Bearer ${token}`,
					},
					body: "hello world",
				},
			),
		);
		expect(blobResponse.status).toBe(204);

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
						bytes: 11,
						checksum: `sha256:${await sha256Hex("hello world")}`,
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

	it("does not allow completion before blob upload exists", async () => {
		const databaseUrl = `file:/tmp/jittle-lamp-${crypto.randomUUID()}.db`;
		await applyMigrations(databaseUrl);

		const db = createDb(databaseUrl);
		expect(db).not.toBeNull();
		if (!db) {
			throw new Error("Database was not created");
		}

		await ensureUserAndPersonalOrganization(db, {
			clerkUserId: "user_clerk_uploads_missing_blob",
			source: "clerk-callback",
			rawPayload: { userId: "user_clerk_uploads_missing_blob" },
		});

		const { privateKey, jwtKey } = await getAuthFixture();
		const checksum = `sha256:${await sha256Hex("hello world")}`;
		const token = await new SignJWT({ scope: "read write" })
			.setProtectedHeader({ alg: "RS256" })
			.setSubject("user_clerk_uploads_missing_blob")
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
					title: "Missing blob upload",
					sourceType: "browser",
					artifact: {
						kind: "recording",
						mimeType: "video/webm",
						bytes: 11,
						checksum,
					},
				}),
			}),
		);
		expect(startResponse.status).toBe(200);
		const startPayload = (await startResponse.json()) as { uploadId: string };

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
						bytes: 11,
						checksum,
						mimeType: "video/webm",
					}),
				},
			),
		);

		expect(completeResponse.status).toBe(409);
		expect(await completeResponse.json()).toEqual({
			error: {
				code: "UPLOAD_BLOB_MISSING",
				message: "Upload blob was not found; upload binary before completing",
				status: 409,
				requestId: null,
			},
		});
	});

	it("rejects blob upload and completion after upload session expires", async () => {
		const databaseUrl = `file:/tmp/jittle-lamp-${crypto.randomUUID()}.db`;
		await applyMigrations(databaseUrl);

		const db = createDb(databaseUrl);
		expect(db).not.toBeNull();
		if (!db) {
			throw new Error("Database was not created");
		}

		await ensureUserAndPersonalOrganization(db, {
			clerkUserId: "user_clerk_uploads_expired",
			source: "clerk-callback",
			rawPayload: { userId: "user_clerk_uploads_expired" },
		});

		const { privateKey, jwtKey } = await getAuthFixture();
		const checksum = `sha256:${await sha256Hex("hello world")}`;
		const token = await new SignJWT({ scope: "read write" })
			.setProtectedHeader({ alg: "RS256" })
			.setSubject("user_clerk_uploads_expired")
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
					title: "Expired upload",
					sourceType: "browser",
					artifact: {
						kind: "recording",
						mimeType: "video/webm",
						bytes: 11,
						checksum,
					},
				}),
			}),
		);
		expect(startResponse.status).toBe(200);
		const startPayload = (await startResponse.json()) as { uploadId: string };

		await db
			.update(evidenceArtifacts)
			.set({ createdAt: Date.now() - 10 * 60 * 1000, updatedAt: Date.now() })
			.where(eq(evidenceArtifacts.id, startPayload.uploadId));

		const blobResponse = await app.handle(
			new Request(
				`http://localhost/evidences/uploads/${startPayload.uploadId}/blob`,
				{
					method: "PUT",
					headers: {
						"content-type": "video/webm",
						authorization: `Bearer ${token}`,
					},
					body: "hello world",
				},
			),
		);
		expect(blobResponse.status).toBe(410);
		expect(await blobResponse.json()).toEqual({
			error: {
				code: "UPLOAD_SESSION_EXPIRED",
				message: "Upload session has expired; start a new upload",
				status: 410,
				requestId: null,
			},
		});

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
						bytes: 11,
						checksum,
						mimeType: "video/webm",
					}),
				},
			),
		);
		expect(completeResponse.status).toBe(410);
		expect(await completeResponse.json()).toEqual({
			error: {
				code: "UPLOAD_SESSION_EXPIRED",
				message: "Upload session has expired; start a new upload",
				status: 410,
				requestId: null,
			},
		});
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
