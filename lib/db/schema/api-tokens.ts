import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * API tokens: what scripts and other apps (the life store, an AI assistant) send as Authorization: Bearer <token>.
 * Only a hash of each token is kept; the token itself is shown once, when it's made.
 */
export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // SHA-256 of the token, hex
  tokenHash: text("token_hash").notNull().unique(),
  // The token's last four characters, so people can tell tokens apart
  hint: text("hint").notNull(),
  // read: GET requests only; write: everything the API does
  access: text("access", { enum: ["read", "write"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
});

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
