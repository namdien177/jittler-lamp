ALTER TABLE `organization_members` ADD `guest_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `organization_members` ADD `invitation_code_id` text;
--> statement-breakpoint
CREATE TABLE `organization_invitation_codes`
(
    `id`                        text PRIMARY KEY           NOT NULL,
    `organization_id`           text                       NOT NULL,
    `label`                     text                       NOT NULL,
    `role`                      text    DEFAULT 'member'   NOT NULL,
    `code_hash`                 text                       NOT NULL,
    `password_hash`             text,
    `email_domain`              text,
    `expires_at`                integer,
    `guest_expires_after_days`  integer,
    `locked_at`                 integer,
    `created_by`                text                       NOT NULL,
    `created_at`                integer                    NOT NULL,
    `updated_at`                integer                    NOT NULL,
    CONSTRAINT `organization_invitation_codes_role_check` CHECK (`role` in ('moderator', 'member')),
    CONSTRAINT `organization_invitation_codes_guest_days_check` CHECK (`guest_expires_after_days` is null or `guest_expires_after_days` > 0),
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_invitation_codes_code_hash_unique` ON `organization_invitation_codes` (`code_hash`);
--> statement-breakpoint
CREATE INDEX `organization_invitation_codes_org_idx` ON `organization_invitation_codes` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `organization_invitation_codes_locked_idx` ON `organization_invitation_codes` (`locked_at`);
