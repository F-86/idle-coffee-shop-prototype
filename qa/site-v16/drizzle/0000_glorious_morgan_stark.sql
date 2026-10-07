CREATE TABLE `coffee_operations` (
	`user_id` text NOT NULL,
	`op_id` text NOT NULL,
	`hash` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`previous_raw` text,
	PRIMARY KEY(`user_id`, `op_id`)
);
--> statement-breakpoint
CREATE TABLE `coffee_saves` (
	`user_id` text PRIMARY KEY NOT NULL,
	`raw` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`session` text,
	`epoch` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_op` text
);
