CREATE TABLE `desktop_recording_sessions`
(
    `id`              text PRIMARY KEY NOT NULL,
    `session_id`      text             NOT NULL,
    `evidence_id`     text             NOT NULL,
    `org_id`          text             NOT NULL,
    `created_by`      text             NOT NULL,
    `source_metadata` text,
    `created_at`      integer          NOT NULL,
    `updated_at`      integer          NOT NULL,
    FOREIGN KEY (`evidence_id`) REFERENCES `evidences` (`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`org_id`) REFERENCES `organizations` (`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_recording_sessions_org_session_unique` ON `desktop_recording_sessions` (`org_id`, `session_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_recording_sessions_evidence_unique` ON `desktop_recording_sessions` (`evidence_id`);
--> statement-breakpoint
CREATE INDEX `desktop_recording_sessions_session_idx` ON `desktop_recording_sessions` (`session_id`);
--> statement-breakpoint
CREATE INDEX `desktop_recording_sessions_org_idx` ON `desktop_recording_sessions` (`org_id`);
--> statement-breakpoint
CREATE INDEX `desktop_recording_sessions_created_by_idx` ON `desktop_recording_sessions` (`created_by`);
--> statement-breakpoint
CREATE INDEX `desktop_recording_sessions_updated_at_idx` ON `desktop_recording_sessions` (`updated_at`);
