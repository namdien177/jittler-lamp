import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { createUuidV7 } from "../uuid";
import { users } from "./users";

export const provisioningStatusSchema = z.enum([
	"pending",
	"processing",
	"succeeded",
	"failed",
]);
export type ProvisioningStatus = z.infer<typeof provisioningStatusSchema>;

export const provisioningEvents = sqliteTable(
	"provisioning_events",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createUuidV7()),
		clerkUserId: text("clerk_user_id").notNull(),
		userId: text("user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		source: text("source").notNull(),
		rawPayload: text("raw_payload").notNull(),
		normalizedPayload: text("normalized_payload"),
		status: text("status")
			.$type<ProvisioningStatus>()
			.notNull()
			.default("pending"),
		attemptCount: integer("attempt_count").notNull().default(0),
		errorMessage: text("error_message"),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		processedAt: integer("processed_at"),
	},
	(table) => [
		index("provisioning_events_clerk_user_idx").on(table.clerkUserId),
		index("provisioning_events_status_idx").on(table.status),
		check(
			"provisioning_events_status_check",
			sql`${table.status} in ('pending', 'processing', 'succeeded', 'failed')`,
		),
	],
);

export const createProvisioningEventSchema = z.object({
	clerkUserId: z.string().min(1),
	source: z.string().trim().min(1),
	rawPayload: z.string().min(2),
});

export const provisioningReplaySchema = z.object({
	eventId: z.string().uuid(),
});
