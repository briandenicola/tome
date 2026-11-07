/**
 * Manual book API
 *
 * Books added by hand: add, change, remove, set the cover, and look an ISBN up. Plain fetch rather than the base
 * client: a cover goes up as form data, and a failed lookup shouldn't be retried (Open Library was asked once).
 */

import { ApiError } from "../../base-client";
import type { Book } from "@/lib/db/schema/books";
import type { IsbnLookupResult } from "@/lib/services/isbn-lookup.service";

/** The details the add and edit forms send. */
export interface ManualBookRequest {
  title?: string;
  authors?: string[];
  totalPages?: number | null;
  isbn?: string | null;
  publisher?: string | null;
  pubDate?: string | null;
  series?: string | null;
  seriesIndex?: number | null;
  description?: string | null;
  tags?: string[];
}

async function send<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const res = await fetch(endpoint, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : `Tome answered ${res.status}. Try again.`;
    throw new ApiError(message, res.status, endpoint, data);
  }
  return data as T;
}

export const manualBookApi = {
  create: (request: ManualBookRequest) => send<Book>("POST", "/api/books/manual", request),
  update: (bookId: number, request: ManualBookRequest) => send<Book>("PATCH", `/api/books/manual/${bookId}`, request),
  remove: (bookId: number) => send<{ success: true }>("DELETE", `/api/books/manual/${bookId}`),
  uploadCover: (bookId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return send<Book>("PUT", `/api/books/manual/${bookId}/cover`, form);
  },
  setCoverFromUrl: (bookId: number, url: string) => send<Book>("PUT", `/api/books/manual/${bookId}/cover`, { url }),
  removeCover: (bookId: number) => send<Book>("DELETE", `/api/books/manual/${bookId}/cover`),
  lookupIsbn: (isbn: string) => send<IsbnLookupResult>("GET", `/api/books/lookup?isbn=${encodeURIComponent(isbn)}`),
};
