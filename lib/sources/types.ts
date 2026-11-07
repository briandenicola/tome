import type { ReadingSourceId } from "@/lib/db/schema/source-links";

/** One item in a reading app, as Tome reads it: where the reader is, and enough to find or add the Tome book. */
export interface SourceItem {
  externalId: string;
  title: string;
  authors: string[];
  isbn?: string;
  totalPages?: number;
  publisher?: string;
  description?: string;
  series?: string;
  seriesIndex?: number;
  /** 0 to 100. */
  progress: number;
  finished: boolean;
  /** When it was finished, when the app knows. */
  finishedAt?: Date;
  /** When the app last saw reading on it. */
  lastUpdate?: Date;
}

/** A reading app Tome syncs progress from. */
export interface ReadingSource {
  id: ReadingSourceId;
  /** As people know it, for Settings and progress notes. */
  name: string;
  /** Whether its address and credentials are set. */
  configured(): boolean;
  /** Every item with any reading on it. Details (ISBN, pages) may be missing; `details` fills them in. */
  items(): Promise<SourceItem[]>;
  /** The item with all the app knows about it, for matching or adding. */
  details(item: SourceItem): Promise<SourceItem>;
  /** The item's cover image, or null. */
  cover(item: SourceItem): Promise<Buffer | null>;
}

/** An app that couldn't be read: the message says what to check. Shown in Settings as is. */
export class SourceError extends Error {}

const TIMEOUT_MS = 20_000;

/** GET or POST JSON from an app, with a plain error when it can't be reached or refuses. */
export async function requestJson<T>(
  name: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", ...(init.body !== undefined && { "content-type": "application/json" }), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new SourceError(`Couldn't reach ${name} at ${new URL(url).origin}. Check the address and that it's running.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SourceError(`${name} refused the credentials (${res.status}). Check them in Tome's environment.`);
  }
  if (!res.ok) throw new SourceError(`${name} answered ${res.status} for ${new URL(url).pathname}.`);
  return (await res.json()) as T;
}

/** Fetches an image, or null when there's none. */
export async function requestImage(url: string, headers: Record<string, string>): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** A base URL without its trailing slash, or null when unset. */
export function baseUrl(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v.replace(/\/+$/, "") : null;
}
