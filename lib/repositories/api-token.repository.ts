import { desc, eq } from "drizzle-orm";
import { BaseRepository } from "./base.repository";
import { apiTokens, ApiToken, NewApiToken } from "@/lib/db/schema/api-tokens";

/** API tokens, found by the hash of the token. */
export class ApiTokenRepository extends BaseRepository<ApiToken, NewApiToken, typeof apiTokens> {
  constructor() {
    super(apiTokens);
  }

  /** Every token, newest first. */
  async listNewestFirst(): Promise<ApiToken[]> {
    return this.getDatabase().select().from(apiTokens).orderBy(desc(apiTokens.createdAt), desc(apiTokens.id)).all();
  }

  async findByHash(tokenHash: string): Promise<ApiToken | undefined> {
    return this.getDatabase().select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).get();
  }

  /** Notes that a token was just used. */
  async touch(id: number, at = new Date()): Promise<void> {
    this.getDatabase().update(apiTokens).set({ lastUsedAt: at }).where(eq(apiTokens.id, id)).run();
  }
}

export const apiTokenRepository = new ApiTokenRepository();
