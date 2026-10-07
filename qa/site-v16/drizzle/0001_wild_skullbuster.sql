ALTER TABLE `coffee_operations` ADD `result` text;--> statement-breakpoint
ALTER TABLE `coffee_saves` ADD `online_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `coffee_saves` ADD `protocol` integer DEFAULT 1 NOT NULL;