CREATE TABLE `source_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`book_id` integer,
	`title` text NOT NULL,
	`matched_by` text,
	`last_progress` real DEFAULT 0 NOT NULL,
	`last_finished` integer DEFAULT false NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_links_source_item` ON `source_links` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_source_links_book` ON `source_links` (`book_id`);--> statement-breakpoint
CREATE TABLE `source_syncs` (
	`source` text PRIMARY KEY NOT NULL,
	`baselined_at` integer,
	`last_run_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`last_summary` text
);
