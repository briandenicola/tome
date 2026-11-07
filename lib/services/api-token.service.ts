import { createHash, randomBytes } from "crypto";
import { apiTokenRepository } from "@/lib/repositories/api-token.repository";
import type { ApiToken } from "@/lib/db/schema/api-tokens";
import type { TokenAccess } from "@/lib/auth";

/** An API token as the settings page shows it: never the token itself, nor its hash. */
export interface ApiTokenView {
  id: number;
  name: string;
  hint: string;
  access: TokenAccess;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** A token that can't be made as asked: the message says what to change. */
export class TokenInputError extends Error {}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

const view = (t: ApiToken): ApiTokenView => ({
  id: t.id,
  name: t.name,
  hint: t.hint,
  access: t.access,
  createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt ?? null,
});

/** How often a token's last use is written, at most: not on every request. */
const TOUCH_EVERY_MS = 60_000;

export class ApiTokenService {
  /** Makes a token. The token is in the answer this once; afterwards only its hint is shown. */
  async create(name: string, access: TokenAccess): Promise<{ token: string; apiToken: ApiTokenView }> {
    const trimmed = name.trim();
    if (!trimmed) throw new TokenInputError("Give the token a name, like the app that will use it.");
    if (trimmed.length > 100) throw new TokenInputError("Keep the name under 100 characters.");
    if (access !== "read" && access !== "write") throw new TokenInputError('Access is "read" or "write".');
    const token = `tome_${randomBytes(24).toString("base64url")}`;
    const created = await apiTokenRepository.create({ name: trimmed, tokenHash: hash(token), hint: token.slice(-4), access });
    return { token, apiToken: view(created) };
  }

  async list(): Promise<ApiTokenView[]> {
    return (await apiTokenRepository.listNewestFirst()).map(view);
  }

  /** Revokes a token: it stops working at once. False when there was no such token. */
  async revoke(id: number): Promise<boolean> {
    return apiTokenRepository.delete(id);
  }

  /** What a token may do, or null when it isn't one. Notes when it was used. */
  async verify(token: string): Promise<TokenAccess | null> {
    if (!token.startsWith("tome_")) return null;
    const found = await apiTokenRepository.findByHash(hash(token));
    if (!found) return null;
    const now = new Date();
    if (!found.lastUsedAt || now.getTime() - found.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      await apiTokenRepository.touch(found.id, now);
    }
    return found.access;
  }
}

export const apiTokenService = new ApiTokenService();
