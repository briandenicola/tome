import { getLogger } from "@/lib/logger";
import { ManualBookError } from "@/lib/services/manual-book.service";

/**
 * Fills the add-a-book form from an ISBN, using Open Library. Called only when the person clicks Look up: Tome never
 * reaches out on its own, and the form works without it.
 */

/** What a lookup found, in the form's terms. Fields Open Library doesn't have are left out. */
export interface IsbnLookupResult {
  isbn: string;
  title?: string;
  authors?: string[];
  totalPages?: number;
  publisher?: string;
  /** YYYY, YYYY-MM or YYYY-MM-DD. */
  pubDate?: string;
  description?: string;
  coverUrl?: string;
}

const OPEN_LIBRARY = "https://openlibrary.org";
/** Open Library's `jscmd=data` endpoint resolves authors and publishers before answering and is often slow. */
const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_000;
/** Open Library asks API clients to identify themselves; anonymous clients are throttled harder. */
const USER_AGENT = "Tome (self-hosted book tracker)";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Open Library's free-text publish date ("May 17, 2010", "2010", "2010-05-17") as YYYY[-MM[-DD]]. */
export function normalizePublishDate(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  const iso = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s);
  if (iso) return [iso[1], iso[2], iso[3]].filter(Boolean).join("-");
  const year = /\b(\d{4})\b/.exec(s)?.[1];
  if (!year) return undefined;
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m}`, "i").test(s));
  if (month < 0) return year;
  const mm = String(month + 1).padStart(2, "0");
  const day = /\b(\d{1,2})\b(?!\d)/.exec(s.replace(year, ""))?.[1];
  return day && Number(day) <= 31 ? `${year}-${mm}-${day.padStart(2, "0")}` : `${year}-${mm}`;
}

/** Maps Open Library's `jscmd=data` answer for one ISBN to the form's fields. Pure, for tests. */
export function mapOpenLibrary(isbn: string, data: unknown): IsbnLookupResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const names = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x) => (x && typeof x === "object" ? (x as { name?: unknown }).name : undefined)).filter((n): n is string => typeof n === "string" && !!n.trim())
      : [];
  const title = typeof d.title === "string" ? [d.title, typeof d.subtitle === "string" ? d.subtitle : ""].filter(Boolean).join(": ") : undefined;
  const authors = names(d.authors);
  const pages = typeof d.number_of_pages === "number" && d.number_of_pages > 0 ? Math.round(d.number_of_pages) : undefined;
  const publisher = names(d.publishers)[0];
  const cover = d.cover && typeof d.cover === "object" ? (d.cover as Record<string, unknown>) : {};
  const coverUrl = [cover.large, cover.medium].find((u): u is string => typeof u === "string" && u.startsWith("https://"));
  const notes = typeof d.notes === "string" ? d.notes : undefined;
  const result: IsbnLookupResult = { isbn };
  if (title) result.title = title;
  if (authors.length) result.authors = authors;
  if (pages) result.totalPages = pages;
  if (publisher) result.publisher = publisher;
  const pubDate = normalizePublishDate(d.publish_date);
  if (pubDate) result.pubDate = pubDate;
  if (notes) result.description = notes;
  if (coverUrl) result.coverUrl = coverUrl;
  return result.title ? result : null;
}

export async function lookupIsbn(raw: unknown): Promise<IsbnLookupResult> {
  const isbn = typeof raw === "string" ? raw.replace(/[\s-]/g, "").toUpperCase() : "";
  if (!/^(\d{9}[\dX]|\d{13})$/.test(isbn)) throw new ManualBookError("The ISBN must have 10 or 13 digits.");
  const url = `${OPEN_LIBRARY}/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const body = await fetchOpenLibrary(url, isbn);
  const found = mapOpenLibrary(isbn, body[`ISBN:${isbn}`]);
  if (!found) throw new ManualBookError("Open Library doesn't know that ISBN. Fill in the details yourself.", 404);
  return found;
}

/** Why a call to Open Library failed, so the form can say something more useful than "couldn't reach". */
class OpenLibraryError extends Error {
  constructor(
    readonly kind: "timeout" | "network" | "http",
    readonly status?: number,
    options?: { cause?: unknown }
  ) {
    super(kind === "http" ? `HTTP ${status}` : kind, options);
  }
  /** A slow answer, a dropped connection, rate limiting or a server error may pass; a 4xx won't. */
  get retryable() {
    return this.kind !== "http" || this.status === 429 || (this.status ?? 0) >= 500;
  }
}

async function fetchOnce(url: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": USER_AGENT },
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new OpenLibraryError(timedOut ? "timeout" : "network", undefined, { cause: error });
  }
  if (!res.ok) throw new OpenLibraryError("http", res.status);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch (error) {
    throw new OpenLibraryError("network", undefined, { cause: error });
  }
}

/** Fetches with one retry for failures that may pass, then turns the last failure into a message for the form. */
async function fetchOpenLibrary(url: string, isbn: string): Promise<Record<string, unknown>> {
  let last: OpenLibraryError | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (error) {
      last = error instanceof OpenLibraryError ? error : new OpenLibraryError("network", undefined, { cause: error });
      getLogger().warn({ err: last.cause ?? last, isbn, attempt, kind: last.kind, status: last.status }, "Open Library lookup failed");
      if (attempt === 2 || !last.retryable) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  const message =
    last?.kind === "timeout"
      ? "Open Library didn't answer in time; it's often slow. Try again, or fill in the details yourself."
      : last?.kind === "http"
        ? `Open Library answered with an error (HTTP ${last.status}). Try again later, or fill in the details yourself.`
        : "Couldn't reach Open Library. Check that Tome's server can reach openlibrary.org, or fill in the details yourself.";
  throw new ManualBookError(message, last?.kind === "timeout" ? 504 : 502);
}
