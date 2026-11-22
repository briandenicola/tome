import { formatInTimeZone } from "date-fns-tz";
import { and, eq, gte, lte } from "drizzle-orm";
import { getDatabase } from "@/lib/db/context";
import { progressLogs } from "@/lib/db/schema/progress-logs";
import { books } from "@/lib/db/schema/books";
import type { ReadingFormat } from "@/lib/db/schema/reading-sessions";
import { isValidDateFormat } from "@/lib/db/sql-helpers";
import { bookRepository, progressRepository, sessionRepository } from "@/lib/repositories";
import { buildReadingReport } from "@/lib/services/reading-report.service";
import { effectiveFormat } from "@/lib/utils/reading-format";
import { getCurrentUserTimezone } from "@/utils/dateHelpers.server";

/**
 * Reading insights for a year: a day-by-day record of reading for the calendar heatmap, how fast each finished book
 * went, and when the books being read now should be finished at the current pace. Built from progress logs, so a day
 * counts when progress was logged on it (by hand or synced from a reading app).
 */

export interface HeatmapDay {
  /** YYYY-MM-DD. */
  date: string;
  pages: number;
  /** The books with progress logged that day. */
  books: string[];
}

export interface PaceBook {
  bookId: number;
  title: string;
  days: number;
  pages: number;
  pagesPerDay: number;
  format: ReadingFormat | null;
}

export interface CurrentPace {
  bookId: number;
  title: string;
  percentage: number;
  pagesLeft: number;
  /** Pages a day over the last two weeks of this read (or since it started, if sooner); null when nothing moved. */
  pagesPerDay: number | null;
  /** YYYY-MM-DD, at that pace; null without one. */
  estimatedFinish: string | null;
  format: ReadingFormat | null;
}

export interface ReadingInsights {
  year: number;
  heatmap: {
    days: HeatmapDay[];
    activeDays: number;
    totalPages: number;
    /** Most consecutive days with reading, within the year. */
    longestRun: number;
    bestDay: HeatmapDay | null;
    /** Pages for the busiest weekday, Sunday first. */
    byWeekday: number[];
  };
  pace: {
    /** Over finished books with a start date and a page count. */
    averagePagesPerDay: number | null;
    averageDays: number | null;
    fastest: PaceBook | null;
    slowest: PaceBook | null;
    byFormat: Array<{ format: ReadingFormat; books: number; averageDays: number; averagePagesPerDay: number }>;
    current: CurrentPace[];
  };
}

const PACE_WINDOW_DAYS = 14;
const round1 = (n: number) => Math.round(n * 10) / 10;
const dayMs = 86_400_000;
const toDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function longestRun(dates: string[]): number {
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const d of [...dates].sort()) {
    const t = toDay(d);
    run = previous !== null && t - previous === dayMs ? run + 1 : 1;
    best = Math.max(best, run);
    previous = t;
  }
  return best;
}

async function heatmapFor(year: number): Promise<ReadingInsights["heatmap"]> {
  const rows = getDatabase()
    .select({ date: progressLogs.progressDate, pages: progressLogs.pagesRead, title: books.title })
    .from(progressLogs)
    .innerJoin(books, eq(progressLogs.bookId, books.id))
    .where(and(isValidDateFormat(progressLogs.progressDate), gte(progressLogs.progressDate, `${year}-01-01`), lte(progressLogs.progressDate, `${year}-12-31`)))
    .all();

  const byDate = new Map<string, { pages: number; books: Set<string> }>();
  for (const r of rows) {
    const day = byDate.get(r.date) ?? { pages: 0, books: new Set<string>() };
    day.pages += r.pages ?? 0;
    day.books.add(r.title);
    byDate.set(r.date, day);
  }
  const days: HeatmapDay[] = [...byDate.entries()]
    .map(([date, d]) => ({ date, pages: d.pages, books: [...d.books].sort() }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) byWeekday[new Date(toDay(d.date)).getUTCDay()] += d.pages;
  const bestDay = days.reduce<HeatmapDay | null>((best, d) => (!best || d.pages > best.pages ? d : best), null);

  return {
    days,
    activeDays: days.length,
    totalPages: days.reduce((n, d) => n + d.pages, 0),
    longestRun: longestRun(days.map((d) => d.date)),
    bestDay: bestDay && bestDay.pages > 0 ? bestDay : null,
    byWeekday,
  };
}

async function currentPace(today: string): Promise<CurrentPace[]> {
  const sessions = await sessionRepository.findByStatus("reading", true);
  const found = new Map((await bookRepository.findByIds(sessions.map((s) => s.bookId))).map((b) => [b.id, b]));
  const out: CurrentPace[] = [];
  for (const s of sessions) {
    const book = found.get(s.bookId);
    if (!book) continue;
    const logs = await progressRepository.findBySessionId(s.id);
    const latest = logs.reduce<(typeof logs)[number] | null>(
      (a, l) => (!a || l.progressDate > a.progressDate || (l.progressDate === a.progressDate && l.id > a.id) ? l : a),
      null
    );
    const percentage = latest?.currentPercentage ?? 0;
    const total = book.totalPages ?? 0;
    const pagesLeft = total ? Math.max(0, total - (latest?.currentPage ?? 0)) : 0;

    // Pages over the last two weeks, or since the read began if that's sooner.
    const windowStart = fromDay(toDay(today) - (PACE_WINDOW_DAYS - 1) * dayMs);
    const started = s.startedDate && s.startedDate > windowStart ? s.startedDate : windowStart;
    const span = Math.max(1, Math.round((toDay(today) - toDay(started)) / dayMs) + 1);
    const recent = logs.filter((l) => l.progressDate >= started).reduce((n, l) => n + (l.pagesRead ?? 0), 0);
    const pagesPerDay = recent > 0 ? round1(recent / span) : null;
    const estimatedFinish =
      pagesPerDay && pagesLeft > 0 ? fromDay(toDay(today) + Math.ceil(pagesLeft / pagesPerDay) * dayMs) : pagesLeft === 0 && total ? today : null;

    out.push({ bookId: book.id, title: book.title, percentage, pagesLeft, pagesPerDay, estimatedFinish, format: effectiveFormat(s.format, book.source) });
  }
  return out.sort((a, b) => (a.estimatedFinish ?? "9999").localeCompare(b.estimatedFinish ?? "9999"));
}

export async function buildReadingInsights(year: number): Promise<ReadingInsights> {
  const tz = await getCurrentUserTimezone();
  const today = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const [heatmap, report, current] = await Promise.all([heatmapFor(year), buildReadingReport(year), currentPace(today)]);

  const timed: PaceBook[] = report.books
    .filter((b) => b.days !== null && b.pages)
    .map((b) => ({
      bookId: b.bookId,
      title: b.title,
      days: b.days!,
      pages: b.pages!,
      pagesPerDay: round1(b.pages! / b.days!),
      format: b.format,
    }));
  const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const byPace = [...timed].sort((a, b) => b.pagesPerDay - a.pagesPerDay);

  const byFormat = (["ebook", "audiobook", "print"] as const)
    .map((format) => {
      const these = timed.filter((b) => b.format === format);
      return { format, books: these.length, averageDays: avg(these.map((b) => b.days)) ?? 0, averagePagesPerDay: avg(these.map((b) => b.pagesPerDay)) ?? 0 };
    })
    .filter((f) => f.books > 0);

  return {
    year,
    heatmap,
    pace: {
      averagePagesPerDay: avg(timed.map((b) => b.pagesPerDay)),
      averageDays: avg(timed.map((b) => b.days)),
      fastest: byPace[0] ?? null,
      slowest: byPace.length > 1 ? byPace[byPace.length - 1]! : null,
      byFormat,
      current,
    },
  };
}
