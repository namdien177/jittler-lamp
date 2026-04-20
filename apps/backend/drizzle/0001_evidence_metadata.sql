CREATE TABLE `evidences` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`created_by` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`source_uri` text,
	`source_external_id` text,
	`source_metadata` text,
	`thumbnail_base64` text,
	`thumbnail_mime_type` text,
	`scope_type` text DEFAULT 'organization' NOT NULL,
	`scope_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `evidences_scope_type_check` CHECK (`scope_type` in ('organization', 'team'))
);
--> statement-breakpoint
CREATE INDEX `evidences_org_id_idx` ON `evidences` (`org_id`);
--> statement-breakpoint
CREATE INDEX `evidences_created_by_idx` ON `evidences` (`created_by`);
--> statement-breakpoint
CREATE INDEX `evidences_org_created_at_idx` ON `evidences` (`org_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidences_org_id_id_unique` ON `evidences` (`org_id`,`id`);
--> statement-breakpoint
CREATE INDEX `evidences_source_lookup_idx` ON `evidences` (`org_id`,`source_type`,`source_external_id`);
--> statement-breakpoint
CREATE INDEX `evidences_scope_lookup_idx` ON `evidences` (`scope_type`,`scope_id`);
--> statement-breakpoint
CREATE INDEX `evidences_updated_at_idx` ON `evidences` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `evidence_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`evidence_id` text NOT NULL,
	`kind` text NOT NULL,
	`s3_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`checksum` text NOT NULL,
	`upload_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidences`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `evidence_artifacts_kind_check` CHECK (`kind` in ('recording', 'transcript', 'screenshot', 'network-log', 'attachment')),
	CONSTRAINT `evidence_artifacts_upload_status_check` CHECK (`upload_status` in ('pending', 'uploading', 'uploaded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `evidence_artifacts_evidence_id_idx` ON `evidence_artifacts` (`evidence_id`);
--> statement-breakpoint
CREATE INDEX `evidence_artifacts_kind_idx` ON `evidence_artifacts` (`kind`);
--> statement-breakpoint
CREATE INDEX `evidence_artifacts_upload_status_idx` ON `evidence_artifacts` (`upload_status`);
--> statement-breakpoint
CREATE INDEX `evidence_artifacts_evidence_kind_idx` ON `evidence_artifacts` (`evidence_id`,`kind`);
--> statement-breakpoint
CREATE TABLE `share_links` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`evidence_id` text NOT NULL,
	`org_id` text NOT NULL,
	`scope_type` text DEFAULT 'organization' NOT NULL,
	`scope_id` text,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`,`evidence_id`) REFERENCES `evidences`(`org_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `share_links_scope_type_check` CHECK (`scope_type` in ('organization', 'team', 'public'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_token_hash_unique` ON `share_links` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `share_links_org_id_idx` ON `share_links` (`org_id`);
--> statement-breakpoint
CREATE INDEX `share_links_evidence_id_idx` ON `share_links` (`evidence_id`);
--> statement-breakpoint
CREATE INDEX `share_links_lookup_idx` ON `share_links` (`org_id`,`evidence_id`);
--> statement-breakpoint
CREATE INDEX `share_links_scope_lookup_idx` ON `share_links` (`scope_type`,`scope_id`);
--> statement-breakpoint
CREATE INDEX `share_links_expires_at_idx` ON `share_links` (`expires_at`);
