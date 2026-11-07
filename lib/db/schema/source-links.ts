import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { books } from "./books";

/** The apps Tome reads progress from. */
export const READING_SOURCES = ["audiobookshelf", "grimmory"] as const;
export type ReadingSourceId = (typeof READING_SOURCES)[number];

/**
 * One item in a reading app (an Audiobookshelf library item, a Grimmory book) and the Tome book it counts toward.
 * Holds what the app last reported, so a sync logs only what changed. `bookId` is null for an item seen on the first
 * sync that matched no Tome book: it's added to Tome only once there's new reading on it.
 */
export const sourceLinks = sqliteTable(
  "source_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source", { enum: READING_SOURCES }).notNull(),
    externalId: text("external_id").notNull(),
    bookId: integer("book_id").references(() => books.id, { onDelete: "set null" }),
    /** The item's title in the app, to show beside the Tome book. */
    title: text("title").notNull(),
    /** How the link was made: by ISBN, by title and author, by adding the book, or by a person. */
    matchedBy: text("matched_by", { enum: ["isbn", "title", "added", "person"] }),
    /** Progress the app last reported, 0 to 100. */
    lastProgress: real("last_progress").notNull().default(0),
    lastFinished: integer("last_finished", { mode: "boolean" }).notNull().default(false),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    sourceItemIdx: uniqueIndex("idx_source_links_source_item").on(table.source, table.externalId),
    bookIdx: index("idx_source_links_book").on(table.bookId),
  })
);

/** Per app: when its first sync recorded where everything was, and how the last sync went. */
export const sourceSyncs = sqliteTable("source_syncs", {
  source: text("source", { enum: READING_SOURCES }).primaryKey(),
  baselinedAt: integer("baselined_at", { mode: "timestamp" }),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),
  lastError: text("last_error"),
  /** What the last sync did, e.g. "3 updated, 1 added". */
  lastSummary: text("last_summary"),
});

export type SourceLink = typeof sourceLinks.$inferSelect;
export type NewSourceLink = typeof sourceLinks.$inferInsert;
export type SourceSync = typeof sourceSyncs.$inferSelect;
