/**
 * Token API Types
 */

export type TokenAccess = "read" | "write";

/** An API token as the API lists it: never the token itself. Dates come as ISO strings. */
export interface ApiTokenInfo {
  id: number;
  name: string;
  hint: string;
  access: TokenAccess;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateTokenRequest {
  name: string;
  access: TokenAccess;
}

export interface CreateTokenResponse {
  success: true;
  data: { token: string; apiToken: ApiTokenInfo };
}

export interface ListTokensResponse {
  success: true;
  data: ApiTokenInfo[];
}
