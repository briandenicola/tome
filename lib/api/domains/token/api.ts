/**
 * Token API
 *
 * Domain API for API tokens: what other apps send as Authorization: Bearer <token>.
 */

import { baseApiClient } from "../../base-client";
import type { CreateTokenRequest, CreateTokenResponse, ListTokensResponse } from "./types";

export const tokenApi = {
  /** Every token, newest first. */
  list: (): Promise<ListTokensResponse> => {
    return baseApiClient["get"]<ListTokensResponse>("/api/tokens");
  },

  /** Makes a token. The answer holds the token itself, this once. */
  create: (request: CreateTokenRequest): Promise<CreateTokenResponse> => {
    return baseApiClient["post"]<CreateTokenRequest, CreateTokenResponse>("/api/tokens", request);
  },

  /** Revokes a token: it stops working at once. */
  revoke: (id: number): Promise<{ success: true }> => {
    return baseApiClient["delete"]<undefined, { success: true }>(`/api/tokens/${id}`);
  },
};
