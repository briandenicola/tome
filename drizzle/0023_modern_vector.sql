-- Calibre becomes optional: calibre_id may be null (books added by hand), each book records its source, and books
-- added by hand keep their cover's file name. SQLite can't drop NOT NULL in place, so the table is rebuilt; migrate.ts
-- turns foreign keys off around it (ADR-015). Existing books keep their ids and Calibre ids and get source 'calibre'.
-- The hand-written triggers and indexes from 0005, 0006, 0008, 0011/0013 and 0017 are recreated after the rebuild.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`calibre_id` integer,
	`source` text DEFAULT 'calibre' NOT NULL,
	`title` text NOT NULL,
	`authors` text DEFAULT '[]' NOT NULL,
	`author_sort` text,
	`isbn` text,
	`total_pages` integer,
	`added_to_library` integer DEFAULT (unixepoch()) NOT NULL,
	`last_synced` integer DEFAULT (unixepoch()) NOT NULL,
	`publisher` text,
	`pub_date` integer,
	`series` text,
	`series_index` real,
	`tags` text DEFAULT '[]' NOT NULL,
	`path` text NOT NULL,
	`cover_file` text,
	`description` text,
	`rating` integer,
	`orphaned` integer DEFAULT false NOT NULL,
	`orphaned_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_books`("id", "calibre_id", "source", "title", "authors", "author_sort", "isbn", "total_pages", "added_to_library", "last_synced", "publisher", "pub_date", "series", "series_index", "tags", "path", "cover_file", "description", "rating", "orphaned", "orphaned_at", "created_at", "updated_at") SELECT "id", "calibre_id", 'calibre', "title", "authors", "author_sort", "isbn", "total_pages", "added_to_library", "last_synced", "publisher", "pub_date", "series", "series_index", "tags", "path", NULL, "description", "rating", "orphaned", "orphaned_at", "created_at", "updated_at" FROM `books`;--> statement-breakpoint
DROP TABLE `books`;--> statement-breakpoint
ALTER TABLE `__new_books` RENAME TO `books`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `books_calibre_id_unique` ON `books` (`calibre_id`);--> statement-breakpoint
CREATE INDEX `idx_books_author_sort` ON `books` (`author_sort`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_source ON books(source);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_rating ON books(rating);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_created_at ON books(created_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_orphaned ON books(orphaned);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_orphaned_created ON books(orphaned, created_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_title_search ON books(title COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_series_composite ON books(series, orphaned, series_index, id) WHERE series IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_books_series_list ON books(series, orphaned) WHERE series IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER books_rating_check_insert
  BEFORE INSERT ON books
  WHEN NEW.rating IS NOT NULL AND (NEW.rating < 1 OR NEW.rating > 5)
BEGIN
  SELECT RAISE(ABORT, 'rating must be between 1 and 5');
END;--> statement-breakpoint
CREATE TRIGGER books_rating_check_update
  BEFORE UPDATE ON books
  WHEN NEW.rating IS NOT NULL AND (NEW.rating < 1 OR NEW.rating > 5)
BEGIN
  SELECT RAISE(ABORT, 'rating must be between 1 and 5');
END;--> statement-breakpoint
ANALYZE books;
