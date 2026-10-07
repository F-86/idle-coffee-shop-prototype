CREATE TABLE `coffee_backups` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`raw` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
