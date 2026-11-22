import { readingGoalRepository } from "@/lib/repositories/reading-goals.repository";

/**
 * The year's reading report: every book finished in a year, with its tags, when it was read and its rating, ready to
 * show or to export as Markdown or CSV. A book read twice in the year appears once per read.
 */

export interface ReportRow {
  bookId: number;
  title: string;
  authors: string[];
  series: string | null;
  seriesIndex: number | null;
  tags: string[];
  /** YYYY-MM-DD; null when the read has no start date. */
  startedDate: string | null;
  /** YYYY-MM-DD. */
  finishedDate: string;
  /** Days from start to finish, counting both; null without a start date. */
  days: number | null;
  /** 1 to 5, or null when unrated. The book's rating now: Tome keeps one rating per book, not one per read. */
  rating: number | null;
  pages: number | null;
  /** True for a second or later read of the book. */
  reread: boolean;
}

export interface ReadingReport {
  year: number;
  books: ReportRow[];
  summary: { count: number; pages: number; rated: number; averageRating: number | null; averageDays: number | null };
}

export const REPORT_FORMATS = ["json", "md", "csv"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

function daysBetween(start: string, end: string): number | null {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function buildReadingReport(year: number): Promise<ReadingReport> {
  const finished = await readingGoalRepository.getBooksByCompletionYear(null, year);
  const books: ReportRow[] = finished
    .map((b) => ({
      bookId: b.id,
      title: b.title,
      authors: b.authors ?? [],
      series: b.series ?? null,
      seriesIndex: b.seriesIndex ?? null,
      tags: [...(b.tags ?? [])].sort((x, y) => x.localeCompare(y)),
      startedDate: b.startedDate ?? null,
      finishedDate: b.completedDate,
      days: b.startedDate ? daysBetween(b.startedDate, b.completedDate) : null,
      rating: b.rating ?? null,
      pages: b.totalPages ?? null,
      reread: (b.sessionNumber ?? 1) > 1,
    }))
    // Oldest first: a report reads as the year went.
    .sort((x, y) => x.finishedDate.localeCompare(y.finishedDate) || x.title.localeCompare(y.title));

  const rated = books.filter((b) => b.rating !== null);
  const timed = books.filter((b) => b.days !== null);
  return {
    year,
    books,
    summary: {
      count: books.length,
      pages: books.reduce((n, b) => n + (b.pages ?? 0), 0),
      rated: rated.length,
      averageRating: rated.length ? round1(rated.reduce((n, b) => n + b.rating!, 0) / rated.length) : null,
      averageDays: timed.length ? round1(timed.reduce((n, b) => n + b.days!, 0) / timed.length) : null,
    },
  };
}

const CSV_COLUMNS = ["Title", "Authors", "Series", "Tags", "Started", "Finished", "Days", "Rating", "Pages", "Re-read"];

/** A CSV cell: quoted when it must be, and never read as a formula by a spreadsheet. */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const seriesLabel = (r: ReportRow) => (r.series ? (r.seriesIndex !== null ? `${r.series} #${r.seriesIndex}` : r.series) : null);

export function reportToCsv(report: ReadingReport): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of report.books) {
    lines.push(
      [
        r.title,
        r.authors.join("; "),
        seriesLabel(r),
        r.tags.join("; "),
        r.startedDate,
        r.finishedDate,
        r.days,
        r.rating,
        r.pages,
        r.reread ? "yes" : "no",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Text safe inside a Markdown table cell. */
const mdCell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const stars = (rating: number | null) => (rating === null ? "—" : "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating)));

export function reportToMarkdown(report: ReadingReport): string {
  const { year, books, summary } = report;
  const out = [`# Books read in ${year}`, ""];
  if (books.length === 0) {
    out.push(`No books finished in ${year}.`, "");
    return out.join("\n");
  }
  const facts = [`${summary.count} ${summary.count === 1 ? "book" : "books"}`, `${summary.pages.toLocaleString("en-US")} pages`];
  if (summary.averageRating !== null) facts.push(`average rating ${summary.averageRating} (${summary.rated} rated)`);
  if (summary.averageDays !== null) facts.push(`${summary.averageDays} days per book on average`);
  out.push(facts.join(" · "), "");
  out.push("| # | Title | Authors | Tags | Started | Finished | Days | Rating |");
  out.push("|---:|---|---|---|---|---|---:|---|");
  books.forEach((r, i) => {
    const series = seriesLabel(r);
    const title = mdCell(r.title) + (series ? ` _(${mdCell(series)})_` : "") + (r.reread ? " (re-read)" : "");
    out.push(
      `| ${i + 1} | ${title} | ${mdCell(r.authors.join(", "))} | ${mdCell(r.tags.join(", ")) || "—"} | ${r.startedDate ?? "—"} | ${r.finishedDate} | ${r.days ?? "—"} | ${stars(r.rating)} |`
    );
  });
  out.push("");
  return out.join("\n");
}
