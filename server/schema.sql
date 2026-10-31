CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`session_id` text NOT NULL,
	`sender` integer NOT NULL,
	`client_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`code`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_delivery` ON `messages` (`code`,`session_id`,`sender`,`client_id`);--> statement-breakpoint
CREATE INDEX `message_poll` ON `messages` (`code`,`session_id`,`id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_token_hash` text NOT NULL,
	`host_name` text NOT NULL,
	`guest_token_hash` text,
	`guest_name` text,
	`session_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`host_seen` integer NOT NULL,
	`guest_seen` integer
);
