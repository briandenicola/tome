ALTER TABLE `reading_sessions` ADD `format` text;--> statement-breakpoint
UPDATE `reading_sessions` SET `format` = 'audiobook'
WHERE `format` IS NULL AND `status` IN ('reading', 'read', 'dnf') AND (
  `book_id` IN (SELECT `id` FROM `books` WHERE `source` = 'audiobookshelf')
  OR `book_id` IN (SELECT `book_id` FROM `source_links` WHERE `source` = 'audiobookshelf' AND `book_id` IS NOT NULL)
);--> statement-breakpoint
UPDATE `reading_sessions` SET `format` = 'ebook'
WHERE `format` IS NULL AND `status` IN ('reading', 'read', 'dnf') AND (
  `book_id` IN (SELECT `id` FROM `books` WHERE `source` = 'grimmory')
  OR `book_id` IN (SELECT `book_id` FROM `source_links` WHERE `source` = 'grimmory' AND `book_id` IS NOT NULL)
);
