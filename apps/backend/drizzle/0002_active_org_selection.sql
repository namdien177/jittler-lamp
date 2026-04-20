ALTER TABLE `users` ADD `active_org_id` text;
--> statement-breakpoint
CREATE INDEX `users_active_org_id_idx` ON `users` (`active_org_id`);
