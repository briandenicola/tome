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

/** Statuses with reading on them; unread and won't-read books are left out. */
export const GRIMMORY_STATUSES = ["READING", "RE_READING", "READ", "PARTIALLY_READ", "PAUSED", "ABANDONED"];
const PAGE_SIZE = 100;

/** Maps Grimmory books to items. Physical books are left out: those are logged in Tome by hand. Pure, for tests. */
export function mapGrimmoryBooks(books: GrimmoryBookSummary[]): SourceItem[] {
  const out: SourceItem[] = [];
  for (const b of books) {
    if (b.isPhysical) continue;
    const finished = b.readStatus === "READ";
    const raw = typeof b.readProgress === "number" && Number.isFinite(b.readProgress) ? b.readProgress : 0;
    const progress = finished ? 100 : Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
    if (progress <= 0 && !finished) continue;
    const last = b.lastReadTime ? new Date(b.lastReadTime) : undefined;
    const lastUpdate = last && !isNaN(last.getTime()) ? last : undefined;
    out.push({
      externalId: String(b.id),
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

export const grimmory: ReadingSource = {
  id: "grimmory",
  name: "Grimmory",
  configured: () =>
    !!baseUrl(process.env.GRIMMORY_URL) && !!process.env.GRIMMORY_USERNAME?.trim() && !!process.env.GRIMMORY_PASSWORD,

  async items() {
    const books: GrimmoryBookSummary[] = [];
    const status = GRIMMORY_STATUSES.map((s) => `status=${s}`).join("&");
    for (let page = 0; page < 200; page++) {
      const body = await get<{ content?: GrimmoryBookSummary[]; hasNext?: boolean }>(
        `/api/v1/app/books?${status}&page=${page}&size=${PAGE_SIZE}`
      );
      books.push(...(body.content ?? []));
      if (!body.hasNext) break;
    }
    return mapGrimmoryBooks(books);
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
