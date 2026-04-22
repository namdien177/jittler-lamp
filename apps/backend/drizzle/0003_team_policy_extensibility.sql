ALTER TABLE `organization_members` RENAME TO `organization_members__old`;
--> statement-breakpoint
CREATE TABLE `organization_members`
(
    `id`              text PRIMARY KEY      NOT NULL,
    `organization_id` text                  NOT NULL,
    `user_id`         text                  NOT NULL,
    `team_id`         text,
    `role`            text DEFAULT 'member' NOT NULL,
    `created_at`      integer               NOT NULL,
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `organization_members` (`id`, `organization_id`, `user_id`, `role`, `created_at`)
SELECT `id`, `organization_id`, `user_id`, `role`, `created_at`
FROM `organization_members__old`;
--> statement-breakpoint
DROP TABLE `organization_members__old`;
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_org_user_org_scope_unique` ON `organization_members` (`organization_id`, `user_id`) WHERE `team_id` is null;
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_org_user_team_unique` ON `organization_members` (`organization_id`, `user_id`, `team_id`) WHERE `team_id` is not null;
--> statement-breakpoint
CREATE INDEX `organization_members_user_id_idx` ON `organization_members` (`user_id`);
--> statement-breakpoint
CREATE INDEX `organization_members_team_id_idx` ON `organization_members` (`team_id`);
--> statement-breakpoint
ALTER TABLE `evidences`
    ADD `team_id` text;
--> statement-breakpoint
CREATE INDEX `evidences_team_id_idx` ON `evidences` (`team_id`);
--> statement-breakpoint
ALTER TABLE `share_links`
    ADD `team_id` text;
--> statement-breakpoint
CREATE INDEX `share_links_team_id_idx` ON `share_links` (`team_id`);
