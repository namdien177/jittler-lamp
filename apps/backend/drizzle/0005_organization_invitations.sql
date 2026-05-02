CREATE TABLE `organization_invitations`
(
    `id`              text PRIMARY KEY          NOT NULL,
    `organization_id` text                      NOT NULL,
    `email`           text                      NOT NULL,
    `role`            text    DEFAULT 'member'  NOT NULL,
    `token_hash`      text                      NOT NULL,
    `status`          text    DEFAULT 'pending' NOT NULL,
    `expires_at`      integer                   NOT NULL,
    `invited_by`      text                      NOT NULL,
    `accepted_by`     text,
    `accepted_at`     integer,
    `revoked_at`      integer,
    `created_at`      integer                   NOT NULL,
    `updated_at`      integer                   NOT NULL,
    CONSTRAINT `organization_invitations_status_check` CHECK (`status` in ('pending', 'accepted', 'revoked', 'expired')),
    CONSTRAINT `organization_invitations_role_check` CHECK (`role` in ('owner', 'moderator', 'member')),
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
    FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_invitations_token_hash_unique` ON `organization_invitations` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `organization_invitations_org_idx` ON `organization_invitations` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `organization_invitations_email_idx` ON `organization_invitations` (`email`);
--> statement-breakpoint
CREATE INDEX `organization_invitations_status_idx` ON `organization_invitations` (`status`);
