import { lifestoreFeedRepository } from "@/lib/repositories";
import type { Book } from "@/lib/db/schema/books";
import type { ReadingSession } from "@/lib/db/schema/reading-sessions";
import type { ProgressLog } from "@/lib/db/schema/progress-logs";

/**
 * The life store feed: every book with reading on it, as the life store reads its apps
 * (GET /api/lifestore/records?page=&limit= → { records: [{ kind, id, updatedAt, data }], next }).
 * One record per book, holding its reads (sessions) and the progress logged in them, so a change to any of them
 * changes the record and the life store reads it again. Read-only: an API token with read access is enough.
 */

export const FEED_DEFAULT_LIMIT = 200;
export const FEED_MAX_LIMIT = 500;

export interface FeedRecord {
  kind: "book";
  id: string;
  updatedAt: string;
  data: {
    title: string;
    authors: string[];
    isbn: string | null;
    totalPages: number | null;
    publisher: string | null;
    pubDate: string | null;
    series: string | null;
    seriesIndex: number | null;
    tags: string[];
    rating: number | null;
    source: Book["source"];
    description: string | null;
    sessions: Array<{
      id: number;
      number: number;
      status: ReadingSession["status"];
      startedDate: string | null;
      completedDate: string | null;
      review: string | null;
    }>;
    progress: Array<{
      id: number;
      sessionId: number | null;
      date: string;
      page: number;
      percentage: number;
      pagesRead: number;
      notes: string | null;
    }>;
  };
}

export interface FeedPage {
  records: FeedRecord[];
  /** The page token for the next page; "" when this is the last. */
  next: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Calibre keeps descriptions as HTML: the text, with paragraphs kept apart. */
export function plainText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return text || null;
}

const iso = (d: Date) => d.toISOString();

export function toFeedRecord(book: Book, sessions: ReadingSession[], progress: ProgressLog[]): FeedRecord {
  // The record changes when the book, a read or a progress entry does.
  const times = [book.updatedAt, ...sessions.map((s) => s.updatedAt), ...progress.map((p) => p.createdAt)];
  const updatedAt = new Date(Math.max(...times.map((t) => t.getTime())));
  return {
    kind: "book",
    id: String(book.id),
    updatedAt: iso(updatedAt),
    data: {
      title: book.title,
      authors: book.authors,
      isbn: book.isbn,
      totalPages: book.totalPages,
      publisher: book.publisher,
      pubDate: book.pubDate ? iso(book.pubDate).slice(0, 10) : null,
      series: book.series,
      seriesIndex: book.seriesIndex,
      tags: book.tags,
      rating: book.rating,
      source: book.source,
      description: plainText(book.description),
      sessions: sessions.map((s) => ({
        id: s.id,
        number: s.sessionNumber,
        status: s.status,
        startedDate: s.startedDate,
        completedDate: s.completedDate,
        review: s.review?.trim() || null,
      })),
      progress: progress.map((p) => ({
        id: p.id,
        sessionId: p.sessionId,
        date: p.progressDate,
        page: p.currentPage,
        percentage: p.currentPercentage,
        pagesRead: p.pagesRead,
        notes: p.notes?.trim() || null,
      })),
    },
  };
}

export class FeedPageError extends Error {}

/** One page of the feed. `page` is the token from the last page's `next` ("" or absent for the first). */
export async function feedPage(page: string | null, limitParam: string | null): Promise<FeedPage> {
  const after = page ? Number(page) : 0;
  if (!Number.isInteger(after) || after < 0) throw new FeedPageError("That page token isn't one this feed gave out. Start again without it.");
  const limit = limitParam ? Number(limitParam) : FEED_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new FeedPageError(`limit is a whole number from 1 to ${FEED_MAX_LIMIT}.`);
  const size = Math.min(limit, FEED_MAX_LIMIT);

  const books = await lifestoreFeedRepository.booksWithReading(after, size);
  const ids = books.map((b) => b.id);
  const [sessions, progress] = await Promise.all([lifestoreFeedRepository.sessionsFor(ids), lifestoreFeedRepository.progressFor(ids)]);
  const records = books.map((b) =>
    toFeedRecord(
      b,
      sessions.filter((s) => s.bookId === b.id),
      progress.filter((p) => p.bookId === b.id)
    )
  );
  return { records, next: books.length === size ? String(books[books.length - 1]!.id) : "" };
}
