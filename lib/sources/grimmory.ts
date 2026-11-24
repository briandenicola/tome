import { baseUrl, requestImage, requestJson, SourceError, type ReadingSource, type SourceItem } from "./types";

/**
 * Grimmory (the BookLore fork): reading progress, Kobo's first, for the user Tome signs in as. Grimmory has no API
 * keys, so Tome signs in with GRIMMORY_USERNAME and GRIMMORY_PASSWORD, keeps the token in memory, and signs in again
 * only when Grimmory refuses it. GRIMMORY_URL is its address.
 */

/** One book of GET /api/v1/app/books, as far as Tome reads it. */
export interface GrimmoryBookSummary {
  id: number;
  title?: string;
  authors?: string[];
  readStatus?: string | null;
  readProgress?: number | null;
  lastReadTime?: string | null;
  seriesName?: string | null;
  seriesNumber?: number | null;
  publisher?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  pageCount?: number | null;
  isPhysical?: boolean | null;
}

/** The shelf Grimmory syncs to a Kobo: one per user, always named this (Grimmory's ShelfType.KOBO). */
export const KOBO_SHELF_NAME = "Kobo";

/**
 * Where books on the Kobo shelf go in Tome, from GRIMMORY_KOBO_SHELF: "to-read" (the default), "read-next", or "off"
 * to leave the shelf alone.
 */
export function koboShelfStatus(raw = process.env.GRIMMORY_KOBO_SHELF): "to-read" | "read-next" | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "off" || v === "false" || v === "no" || v === "none") return null;
  return v === "read-next" ? "read-next" : "to-read";
}

/** Statuses with reading on them; unread and won't-read books are left out. */
export const GRIMMORY_STATUSES = ["READING", "RE_READING", "READ", "PARTIALLY_READ", "PAUSED", "ABANDONED"];
const PAGE_SIZE = 50;

/** Maps Grimmory books to items. Physical books are left out: those are logged in Tome by hand. Pure, for tests. */
export function mapGrimmoryBooks(books: GrimmoryBookSummary[], { withoutReading = false } = {}): SourceItem[] {
  const out: SourceItem[] = [];
  for (const b of books) {
    if (b.isPhysical) continue;
    const finished = b.readStatus === "READ";
    const raw = typeof b.readProgress === "number" && Number.isFinite(b.readProgress) ? b.readProgress : 0;
    const progress = finished ? 100 : Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
    if (progress <= 0 && !finished && !withoutReading) continue;
    const last = b.lastReadTime ? new Date(b.lastReadTime) : undefined;
    const lastUpdate = last && !isNaN(last.getTime()) ? last : undefined;
    out.push({
      externalId: String(b.id),
      format: "ebook",
      title: b.title?.trim() || "Untitled",
      authors: (b.authors ?? []).filter((a) => typeof a === "string" && a.trim()),
      ...((b.isbn13 || b.isbn10) && { isbn: (b.isbn13 || b.isbn10)! }),
      ...(b.pageCount && b.pageCount > 0 && { totalPages: b.pageCount }),
      ...(b.publisher && { publisher: b.publisher }),
      ...(b.seriesName && { series: b.seriesName }),
      ...(typeof b.seriesNumber === "number" && { seriesIndex: b.seriesNumber }),
      progress,
      finished,
      ...(finished && lastUpdate && { finishedAt: lastUpdate }),
      ...(lastUpdate && { lastUpdate }),
    });
  }
  return out;
}

let token: string | null = null;

/** Forgets the signed-in token, for tests. */
export function resetGrimmoryToken(): void {
  token = null;
}

async function signIn(): Promise<string> {
  const body = await requestJson<{ accessToken?: string }>("Grimmory", `${base()}/api/v1/auth/login`, {
    method: "POST",
    body: { username: process.env.GRIMMORY_USERNAME!.trim(), password: process.env.GRIMMORY_PASSWORD },
  });
  if (!body.accessToken) throw new SourceError("Grimmory didn't return a token when Tome signed in. Check its version.");
  token = body.accessToken;
  return token;
}

/** A Grimmory request with the token, signing in first, and once more if the token has expired. */
async function get<T>(path: string): Promise<T> {
  const attempt = async (t: string) => requestJson<T>("Grimmory", `${base()}${path}`, { headers: { authorization: `Bearer ${t}` } });
  try {
    return await attempt(token ?? (await signIn()));
  } catch (error) {
    if (error instanceof SourceError && /refused the credentials/.test(error.message) && token) {
      token = null;
      return attempt(await signIn());
    }
    throw error;
  }
}

/** Every page of a GET /api/v1/app/books query. Grimmory serves at most 50 a page, whatever is asked. */
async function allBooks(query: string): Promise<GrimmoryBookSummary[]> {
  const books: GrimmoryBookSummary[] = [];
  for (let page = 0; page < 400; page++) {
    const body = await get<{ content?: GrimmoryBookSummary[]; hasNext?: boolean }>(`/api/v1/app/books?${query}&page=${page}&size=${PAGE_SIZE}`);
    books.push(...(body.content ?? []));
    if (!body.hasNext) break;
  }
  return books;
}

/** The books on the person's Kobo shelf, read or not; none when there's no Kobo shelf. */
export async function koboShelfBooks(): Promise<SourceItem[]> {
  const shelves = await get<Array<{ id: number; name?: string }>>("/api/v1/app/shelves");
  const kobo =
    (shelves ?? []).find((s) => s.name === KOBO_SHELF_NAME) ?? (shelves ?? []).find((s) => s.name?.trim().toLowerCase() === KOBO_SHELF_NAME.toLowerCase());
  if (!kobo) return [];
  return mapGrimmoryBooks(await allBooks(`shelfId=${encodeURIComponent(String(kobo.id))}`), { withoutReading: true });
}

export const grimmory: ReadingSource = {
  id: "grimmory",
  name: "Grimmory",
  configured: () =>
    !!baseUrl(process.env.GRIMMORY_URL) && !!process.env.GRIMMORY_USERNAME?.trim() && !!process.env.GRIMMORY_PASSWORD,

  async items() {
    return mapGrimmoryBooks(await allBooks(GRIMMORY_STATUSES.map((s) => `status=${s}`).join("&")));
  },

  get backlog() {
    const status = koboShelfStatus();
    return status ? { name: "the Kobo shelf", status, items: koboShelfBooks } : undefined;
  },

  // The list already carries ISBN, pages and series.
  details: async (item) => item,

  async cover(item) {
    const t = token ?? (await signIn());
    return requestImage(`${base()}/api/v1/media/book/${encodeURIComponent(item.externalId)}/cover`, { authorization: `Bearer ${t}` });
  },
};

function base() {
  return baseUrl(process.env.GRIMMORY_URL)!;
}
