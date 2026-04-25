CREATE TABLE `desktop_auth_flows`
(
    `id`               text PRIMARY KEY          NOT NULL,
    `device_code_hash` text                      NOT NULL,
    `user_code_hash`   text                      NOT NULL,
    `status`           text    DEFAULT 'pending' NOT NULL,
    `clerk_user_id`    text,
    `expires_at`       integer                   NOT NULL,
    `approved_at`      integer,
    `completed_at`     integer,
    `created_at`       integer                   NOT NULL,
    `updated_at`       integer                   NOT NULL,
    CONSTRAINT `desktop_auth_flows_status_check` CHECK (`status` in ('pending', 'approved', 'denied', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_auth_flows_device_code_hash_unique` ON `desktop_auth_flows` (`device_code_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_auth_flows_user_code_hash_unique` ON `desktop_auth_flows` (`user_code_hash`);
--> statement-breakpoint
CREATE INDEX `desktop_auth_flows_status_idx` ON `desktop_auth_flows` (`status`);
--> statement-breakpoint
CREATE INDEX `desktop_auth_flows_expires_at_idx` ON `desktop_auth_flows` (`expires_at`);
