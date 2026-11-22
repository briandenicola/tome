import { buildReadingReport, type ReportRow } from "@/lib/services/reading-report.service";
import { buildReadingInsights } from "@/lib/services/reading-insights.service";
import type { ReadingFormat } from "@/lib/db/schema/reading-sessions";

/**
 * A year in review: the year's reading told as highlights. The books by the month they were finished, the longest
 * and shortest, the fastest read, the favourites, the authors and tags read most, and how the reading was done.
 * Built from the reading report and insights, so it agrees with them.
 */

export interface ReviewBook {
  bookId: number;
  title: string;
  authors: string[];
  pages: number | null;
  rating: number | null;
  finishedDate: string;
  days: number | null;
  format: ReadingFormat | null;
  lastSynced: string | null;
}

export interface YearReview {
  year: number;
  totals: {
    books: number;
    pages: number;
    readingDays: number;
    longestRun: number;
    averageRating: number | null;
    rereads: number;
    authors: number;
  };
  /** Twelve months, January first, each with the books finished in it. */
  months: Array<{ month: number; books: ReviewBook[] }>;
  highlights: {
    first: ReviewBook | null;
    last: ReviewBook | null;
    longest: ReviewBook | null;
    shortest: ReviewBook | null;
    fastest: (ReviewBook & { pagesPerDay: number }) | null;
    /** Five-star reads, else the highest rated. */
    favourites: ReviewBook[];
    busiestMonth: { month: number; books: number } | null;
  };
  topAuthors: Array<{ name: string; books: number }>;
  topTags: Array<{ name: string; books: number }>;
  formats: Record<ReadingFormat | "unknown", number>;
}

const toReviewBook = (r: ReportRow): ReviewBook => ({
  bookId: r.bookId,
  title: r.title,
  authors: r.authors,
  pages: r.pages,
  rating: r.rating,
  finishedDate: r.finishedDate,
  days: r.days,
  format: r.format,
  lastSynced: r.lastSynced,
});

function top(counts: Map<string, number>, n: number): Array<{ name: string; books: number }> {
  return [...counts.entries()]
    .map(([name, books]) => ({ name, books }))
    .sort((a, b) => b.books - a.books || a.name.localeCompare(b.name))
    .slice(0, n);
}

export async function buildYearReview(year: number): Promise<YearReview> {
  const [report, insights] = await Promise.all([buildReadingReport(year), buildReadingInsights(year)]);
  const rows = report.books; // oldest finish first
  const books = rows.map(toReviewBook);

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    books: books.filter((b) => parseInt(b.finishedDate.slice(5, 7), 10) === i + 1),
  }));
  const busiest = months.reduce<{ month: number; books: number } | null>(
    (best, m) => (m.books.length > 0 && (!best || m.books.length > best.books) ? { month: m.month, books: m.books.length } : best),
    null
  );

  const paged = books.filter((b) => b.pages);
  const byPages = [...paged].sort((a, b) => b.pages! - a.pages! || a.title.localeCompare(b.title));
  const fastest = books
    .filter((b) => b.pages && b.days)
    .map((b) => ({ ...b, pagesPerDay: Math.round((b.pages! / b.days!) * 10) / 10 }))
    .sort((a, b) => b.pagesPerDay - a.pagesPerDay)[0];

  const best = Math.max(0, ...books.map((b) => b.rating ?? 0));
  const favourites = best > 0 ? books.filter((b) => b.rating === best).slice(0, 8) : [];

  const authors = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const r of rows) {
    for (const a of new Set(r.authors)) authors.set(a, (authors.get(a) ?? 0) + 1);
    for (const t of new Set(r.tags)) tags.set(t, (tags.get(t) ?? 0) + 1);
  }

  return {
    year,
    totals: {
      books: report.summary.count,
      pages: report.summary.pages,
      readingDays: insights.heatmap.activeDays,
      longestRun: insights.heatmap.longestRun,
      averageRating: report.summary.averageRating,
      rereads: rows.filter((r) => r.reread).length,
      authors: authors.size,
    },
    months,
    highlights: {
      first: books[0] ?? null,
      last: books.length > 1 ? books[books.length - 1]! : null,
      longest: byPages[0] ?? null,
      shortest: byPages.length > 1 ? byPages[byPages.length - 1]! : null,
      fastest: fastest ?? null,
      favourites,
      busiestMonth: busiest,
    },
    topAuthors: top(authors, 5),
    topTags: top(tags, 8),
    formats: report.summary.formats,
  };
}
