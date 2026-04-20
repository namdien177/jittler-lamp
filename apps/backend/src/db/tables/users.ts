import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { createUuidV7 } from "../uuid";

export const users = sqliteTable(
	"users",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createUuidV7()),
		clerkUserId: text("clerk_user_id").notNull(),
		activeOrgId: text("active_org_id"),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		uniqueIndex("users_clerk_user_id_unique").on(table.clerkUserId),
		index("users_active_org_id_idx").on(table.activeOrgId),
		index("users_created_at_idx").on(table.createdAt),
	],
);

export const createUserInputSchema = z.object({
	clerkUserId: z.string().min(1),
});
