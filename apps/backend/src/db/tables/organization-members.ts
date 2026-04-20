import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { createUuidV7 } from "../uuid";
import { organizations } from "./organizations";
import { users } from "./users";

export const organizationRoleSchema = z.enum(["owner", "member"]);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const organizationMembers = sqliteTable(
	"organization_members",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createUuidV7()),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: text("role").$type<OrganizationRole>().notNull().default("member"),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		uniqueIndex("organization_members_org_user_unique").on(
			table.organizationId,
			table.userId,
		),
		index("organization_members_user_id_idx").on(table.userId),
		check(
			"organization_members_role_check",
			sql`${table.role} in ('owner', 'member')`,
		),
	],
);

export const createOrganizationMembershipInputSchema = z.object({
	organizationId: z.string().uuid(),
	userId: z.string().uuid(),
	role: organizationRoleSchema,
});
