CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`clerk_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_clerk_user_id_unique` ON `users` (`clerk_user_id`);
--> statement-breakpoint
CREATE INDEX `users_created_at_idx` ON `users` (`created_at`);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_personal` integer DEFAULT true NOT NULL,
	`personal_owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`personal_owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `organizations_personal_org_owner_required` CHECK ((`is_personal` = 0 and `personal_owner_user_id` is null) or (`is_personal` = 1 and `personal_owner_user_id` is not null))
);
--> statement-breakpoint
CREATE INDEX `organizations_personal_owner_user_id_idx` ON `organizations` (`personal_owner_user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_one_personal_org_per_user` ON `organizations` (`personal_owner_user_id`) WHERE `personal_owner_user_id` is not null;
--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `organization_members_role_check` CHECK (`role` in ('owner', 'member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_org_user_unique` ON `organization_members` (`organization_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `organization_members_user_id_idx` ON `organization_members` (`user_id`);
--> statement-breakpoint
CREATE TABLE `provisioning_events` (
	`id` text PRIMARY KEY NOT NULL,
	`clerk_user_id` text NOT NULL,
	`user_id` text,
	`source` text NOT NULL,
	`raw_payload` text NOT NULL,
	`normalized_payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `provisioning_events_status_check` CHECK (`status` in ('pending', 'processing', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `provisioning_events_clerk_user_idx` ON `provisioning_events` (`clerk_user_id`);
--> statement-breakpoint
CREATE INDEX `provisioning_events_status_idx` ON `provisioning_events` (`status`);
