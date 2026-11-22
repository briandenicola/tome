import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { bookRepository, sessionRepository } from "@/lib/repositories";
import { GET } from "@/app/api/reports/read/route";
import { buildReadingReport, reportToCsv, reportToMarkdown } from "@/lib/services/reading-report.service";

/** The yearly reading report: books finished in a year, with tags, dates and rating, as JSON, Markdown or CSV. */

beforeAll(async () => {
  await setupTestDatabase(__filename);
});
afterAll(async () => {
  await teardownTestDatabase(__filename);
});
beforeEach(async () => {
  await clearTestDatabase(__filename);
});

async function read(
  title: string,
  session: { status?: "read" | "dnf" | "reading"; startedDate?: string | null; completedDate?: string | null; sessionNumber?: number },
  book: Record<string, unknown> = {}
) {
  const b = await bookRepository.create({ source: "manual", path: "", title, authors: ["Someone"], totalPages: 300, ...book });
  await sessionRepository.create({
    bookId: b.id,
    status: session.status ?? "read",
    sessionNumber: session.sessionNumber ?? 1,
    isActive: false,
    startedDate: session.startedDate ?? null,
    completedDate: session.completedDate ?? null,
  });
  return b;
}

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/reports/read?${qs}`));

describe("the reading report", () => {
  test("lists the year's finished books oldest first, with tags, dates, days and rating", async () => {
    await read("Circe", { startedDate: "2026-03-01", completedDate: "2026-03-10" }, { tags: ["myth", "fiction"], rating: 5 });
    await read("1873", { startedDate: "2026-01-05", completedDate: "2026-02-01" }, { tags: ["history"], rating: 4 });
    await read("No Start", { completedDate: "2026-06-01" });
    await read("Dropped", { status: "dnf", startedDate: "2026-04-01", completedDate: "2026-04-02" });
    await read("Last Year", { startedDate: "2025-12-01", completedDate: "2025-12-31" });

    const report = await buildReadingReport(2026);
    expect(report.books.map((b) => b.title)).toEqual(["1873", "Circe", "No Start"]);
    expect(report.books[1]).toMatchObject({ tags: ["fiction", "myth"], startedDate: "2026-03-01", finishedDate: "2026-03-10", days: 10, rating: 5 });
    expect(report.books[2]).toMatchObject({ startedDate: null, days: null, rating: null });
    expect(report.summary).toEqual({
      count: 3,
      pages: 900,
      rated: 2,
      averageRating: 4.5,
      averageDays: 19,
      formats: { ebook: 0, audiobook: 0, print: 0, unknown: 3 },
    });
  });

  test("a re-read in the year is marked", async () => {
    const b = await read("Dune", { startedDate: "2020-01-01", completedDate: "2020-02-01" });
    await sessionRepository.create({ bookId: b.id, status: "read", sessionNumber: 2, isActive: true, startedDate: "2026-05-01", completedDate: "2026-05-20" });
    const report = await buildReadingReport(2026);
    expect(report.books).toEqual([expect.objectContaining({ title: "Dune", reread: true, days: 20 })]);
  });

  test("CSV quotes what needs quoting and keeps spreadsheets from running formulas", async () => {
    await read('Say "Hello", World', { startedDate: "2026-01-01", completedDate: "2026-01-02" }, { tags: ["a", "b"], rating: 3, authors: ["Ann", "Bo"] });
    await read("=HYPERLINK(1)", { completedDate: "2026-02-01" });
    const csv = reportToCsv(await buildReadingReport(2026));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Title,Authors,Series,Format,Tags,Started,Finished,Days,Rating,Pages,Re-read");
    expect(lines[1]).toBe('"Say ""Hello"", World",Ann; Bo,,,a; b,2026-01-01,2026-01-02,2,3,300,no');
    expect(lines[2].startsWith("'=HYPERLINK(1)")).toBe(true);
  });

  test("Markdown is a titled table that survives pipes in titles", async () => {
    await read("This | That", { startedDate: "2026-01-01", completedDate: "2026-01-03" }, { tags: ["essays"], rating: 4, series: "Pairs", seriesIndex: 2 });
    const md = reportToMarkdown(await buildReadingReport(2026));
    expect(md).toContain("# Books read in 2026");
    expect(md).toContain("1 book · 300 pages · average rating 4 (1 rated) · 3 days per book on average");
    expect(md).toContain("| 1 | This \\| That _(Pairs #2)_ | Someone | — | essays | 2026-01-01 | 2026-01-03 | 3 | ★★★★☆ |");
    expect(reportToMarkdown(await buildReadingReport(2019))).toContain("No books finished in 2019.");
  });
});

describe("formats in the report", () => {
  test("a read's recorded format wins; otherwise the book's source decides; Calibre and hand-added books are unknown", async () => {
    const printed = await read("Printed", { startedDate: "2026-01-01", completedDate: "2026-01-05" });
    const printedSession = (await sessionRepository.findAllByBookId(printed.id))[0]!;
    await sessionRepository.update(printedSession.id, { format: "print" });
    await read("Listened", { startedDate: "2026-02-01", completedDate: "2026-02-05" }, { source: "audiobookshelf" });
    await read("Kobo", { startedDate: "2026-03-01", completedDate: "2026-03-05" }, { source: "grimmory" });
    await read("Unknown", { startedDate: "2026-04-01", completedDate: "2026-04-05" });

    const report = await buildReadingReport(2026);
    expect(report.books.map((b) => [b.title, b.format])).toEqual([
      ["Printed", "print"],
      ["Listened", "audiobook"],
      ["Kobo", "ebook"],
      ["Unknown", null],
    ]);
    expect(report.summary.formats).toEqual({ ebook: 1, audiobook: 1, print: 1, unknown: 1 });
    const md = reportToMarkdown(report);
    expect(md).toContain("Ebook: 1 · Audiobook: 1 · Print: 1");
    expect(md).toContain("| 2 | Listened | Someone | Audiobook |");
    expect(reportToCsv(report)).toContain("Printed,Someone,,Print,");
  });
});

describe("GET /api/reports/read", () => {
  test("serves JSON, or Markdown and CSV as downloads", async () => {
    await read("Circe", { startedDate: "2026-03-01", completedDate: "2026-03-10" });

    const json = await get("year=2026");
    expect((await json.json()).books).toHaveLength(1);

    const csv = await get("year=2026&format=csv");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="books-read-2026.csv"');
    expect(await csv.text()).toContain("Circe");

    const md = await get("year=2026&format=md");
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("content-disposition")).toBe('attachment; filename="books-read-2026.md"');
  });

  test("refuses a bad year or format", async () => {
    expect((await get("year=abc")).status).toBe(400);
    expect((await get("year=1200")).status).toBe(400);
    expect((await get("year=2026&format=pdf")).status).toBe(400);
  });
});
