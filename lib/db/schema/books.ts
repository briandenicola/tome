import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const books = sqliteTable(
  "books",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Set for books synced from Calibre; null for books added by hand.
    calibreId: integer("calibre_id").unique(),
    // Where the book came from: "calibre" (synced), "manual" (added in Tome), or the reading app it was first read in
    // ("audiobookshelf", "grimmory"; added by Tome's source sync). Every source but Calibre is edited in Tome.
    source: text("source", { enum: ["calibre", "manual", "audiobookshelf", "grimmory"] }).notNull().default("calibre"),
    title: text("title").notNull(),
    // Store authors as JSON array
    authors: text("authors", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // Pre-computed sort value for efficient author sorting (e.g., "Sanderson, Brandon")
    authorSort: text("author_sort"),
    isbn: text("isbn"),
    totalPages: integer("total_pages"),
    addedToLibrary: integer("added_to_library", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    lastSynced: integer("last_synced", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    publisher: text("publisher"),
    pubDate: integer("pub_date", { mode: "timestamp" }),
    series: text("series"),
    seriesIndex: real("series_index"),
    // Store tags as JSON array
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // The book's folder in the Calibre library; "" for books added by hand.
    path: text("path").notNull(),
    // For books added by hand: the cover's file name in the covers folder next to the database.
    coverFile: text("cover_file"),
    description: text("description"),
    rating: integer("rating"), // 1-5 stars; synced with Calibre for Calibre books
    orphaned: integer("orphaned", { mode: "boolean" }).notNull().default(false),
    orphanedAt: integer("orphaned_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    // Index for efficient author sorting
    authorSortIdx: index("idx_books_author_sort").on(table.authorSort),
  })
);

export type Book = typeof books.$inferSelect;
export type BookSource = Book["source"];
export type NewBook = typeof books.$inferInsert;
