import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { bookRepository, sessionRepository, progressRepository } from "@/lib/repositories";
import { GET } from "@/app/api/stats/insights/route";
import { buildReadingInsights } from "@/lib/services/reading-insights.service";
import { getCurrentUserTimezone } from "@/utils/dateHelpers.server";

/** Reading insights: the year's days for the heatmap, the pace of finished books, and finish estimates for current reads. */

beforeAll(async () => {
  await setupTestDatabase(__filename);
});
afterAll(async () => {
  await teardownTestDatabase(__filename);
});
beforeEach(async () => {
  await clearTestDatabase(__filename);
});

async function book(title: string, pages = 300, source: "manual" | "audiobookshelf" = "manual") {
  return bookRepository.create({ source, path: "", title, authors: ["Someone"], totalPages: pages });
}
async function log(bookId: number, sessionId: number, date: string, currentPage: number, pagesRead: number, total = 300) {
  return progressRepository.create({ bookId, sessionId, currentPage, currentPercentage: Math.round((currentPage / total) * 1000) / 10, progressDate: date, pagesRead });
}
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("the heatmap", () => {
  test("adds up each day's pages and books, and finds the longest run and best day", async () => {
    const a = await book("Ravenna");
    const b = await book("Circe");
    const sa = await sessionRepository.create({ bookId: a.id, status: "read", sessionNumber: 1, isActive: false, startedDate: "2026-03-01", completedDate: "2026-03-10" });
    const sb = await sessionRepository.create({ bookId: b.id, status: "read", sessionNumber: 1, isActive: false, startedDate: "2026-03-02", completedDate: "2026-03-05" });
    await log(a.id, sa.id, "2026-03-01", 20, 20);
    await log(a.id, sa.id, "2026-03-02", 50, 30);
    await log(b.id, sb.id, "2026-03-02", 40, 40);
    await log(a.id, sa.id, "2026-03-03", 60, 10); // a Tuesday
    await log(a.id, sa.id, "2026-03-07", 90, 30);
    await log(a.id, sa.id, "2025-12-31", 5, 5); // last year: left out

    const { heatmap } = await buildReadingInsights(2026);
    expect(heatmap.days).toEqual([
      { date: "2026-03-01", pages: 20, books: ["Ravenna"] },
      { date: "2026-03-02", pages: 70, books: ["Circe", "Ravenna"] },
      { date: "2026-03-03", pages: 10, books: ["Ravenna"] },
      { date: "2026-03-07", pages: 30, books: ["Ravenna"] },
    ]);
    expect(heatmap).toMatchObject({ activeDays: 4, totalPages: 130, longestRun: 3, bestDay: { date: "2026-03-02", pages: 70 } });
    expect(heatmap.byWeekday).toEqual([20, 70, 10, 0, 0, 0, 30]);
  });
});

describe("pace", () => {
  test("pages a day per finished book, the fastest and slowest, and by format", async () => {
    const quick = await book("Quick", 300);
    const slow = await book("Slow", 100, "audiobookshelf");
    await sessionRepository.create({ bookId: quick.id, status: "read", sessionNumber: 1, isActive: false, startedDate: "2026-01-01", completedDate: "2026-01-10", format: "print" });
    await sessionRepository.create({ bookId: slow.id, status: "read", sessionNumber: 1, isActive: false, startedDate: "2026-02-01", completedDate: "2026-02-20" });

    const { pace } = await buildReadingInsights(2026);
    expect(pace.fastest).toMatchObject({ title: "Quick", days: 10, pagesPerDay: 30, format: "print" });
    expect(pace.slowest).toMatchObject({ title: "Slow", days: 20, pagesPerDay: 5, format: "audiobook" });
    expect(pace).toMatchObject({ averagePagesPerDay: 17.5, averageDays: 15 });
    expect(pace.byFormat).toEqual([
      { format: "audiobook", books: 1, averageDays: 20, averagePagesPerDay: 5 },
      { format: "print", books: 1, averageDays: 10, averagePagesPerDay: 30 },
    ]);
  });

  test("a current read gets a finish date from its last two weeks of reading", async () => {
    const today = formatInTimeZone(new Date(), await getCurrentUserTimezone(), "yyyy-MM-dd");
    const reading = await book("Hyperion", 300);
    const stalled = await book("Stalled", 300);
    const s = await sessionRepository.create({ bookId: reading.id, status: "reading", sessionNumber: 1, isActive: true, startedDate: addDays(today, -60) });
    const t = await sessionRepository.create({ bookId: stalled.id, status: "reading", sessionNumber: 1, isActive: true, startedDate: addDays(today, -60) });
    await log(reading.id, s.id, addDays(today, -40), 100, 100); // outside the window
    await log(reading.id, s.id, addDays(today, -10), 128, 28);
    await log(reading.id, s.id, addDays(today, -1), 156, 28); // 56 pages in 14 days: 4 a day
    await log(stalled.id, t.id, addDays(today, -30), 50, 50);

    const { pace } = await buildReadingInsights(2026);
    expect(pace.current).toEqual([
      expect.objectContaining({ title: "Hyperion", pagesLeft: 144, pagesPerDay: 4, estimatedFinish: addDays(today, 36) }),
      expect.objectContaining({ title: "Stalled", pagesLeft: 250, pagesPerDay: null, estimatedFinish: null }),
    ]);
  });
});

describe("GET /api/stats/insights", () => {
  test("answers for a year, and refuses a bad one", async () => {
    const ok = await GET(new NextRequest("http://localhost/api/stats/insights?year=2026"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ year: 2026, heatmap: { activeDays: 0 }, pace: { fastest: null, current: [] } });
    expect((await GET(new NextRequest("http://localhost/api/stats/insights?year=26"))).status).toBe(400);
  });
});
