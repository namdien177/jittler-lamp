import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { createUuidV7 } from "../uuid";
import { evidences } from "./evidences";
import { organizations } from "./organizations";
import { users } from "./users";

export const desktopRecordingSessions = sqliteTable(
	"desktop_recording_sessions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createUuidV7()),
		sessionId: text("session_id").notNull(),
		evidenceId: text("evidence_id")
			.notNull()
			.references(() => evidences.id, { onDelete: "cascade" }),
		orgId: text("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		createdBy: text("created_by")
			.notNull()
			.references(() => users.id, { onDelete: "restrict" }),
		sourceMetadata: text("source_metadata"),
		createdAt: integer("created_at")
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at")
			.notNull()
			.$defaultFn(() => Date.now()),
	},
	(table) => [
		uniqueIndex("desktop_recording_sessions_org_session_unique").on(
			table.orgId,
			table.sessionId,
		),
		uniqueIndex("desktop_recording_sessions_evidence_unique").on(
			table.evidenceId,
		),
		index("desktop_recording_sessions_session_idx").on(table.sessionId),
		index("desktop_recording_sessions_org_idx").on(table.orgId),
		index("desktop_recording_sessions_created_by_idx").on(table.createdBy),
		index("desktop_recording_sessions_updated_at_idx").on(table.updatedAt),
	],
);
