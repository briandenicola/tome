import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { bookRepository, sessionRepository } from "@/lib/repositories";
import { GET } from "@/app/api/stats/review/route";
import { buildYearReview } from "@/lib/services/year-review.service";

/** The year in review: the year's finished books as months, highlights, favourites and rankings. */

beforeAll(async () => {
  await setupTestDatabase(__filename);
});
afterAll(async () => {
  await teardownTestDatabase(__filename);
});
beforeEach(async () => {
  await clearTestDatabase(__filename);
});

async function finished(
  title: string,
  started: string,
  completed: string,
  extra: { pages?: number; rating?: number | null; authors?: string[]; tags?: string[]; format?: "ebook" | "audiobook" | "print"; sessionNumber?: number } = {}
) {
  const b = await bookRepository.create({
    source: "manual",
    path: "",
    title,
    authors: extra.authors ?? ["Someone"],
    totalPages: extra.pages ?? 300,
    rating: extra.rating ?? null,
    tags: extra.tags ?? [],
  });
  await sessionRepository.create({
    bookId: b.id,
    status: "read",
    sessionNumber: extra.sessionNumber ?? 1,
    isActive: false,
    startedDate: started,
    completedDate: completed,
    format: extra.format ?? null,
  });
  return b;
}

describe("the year in review", () => {
  test("months, highlights, favourites, authors and tags", async () => {
    await finished("Ravenna", "2026-01-02", "2026-01-20", { pages: 608, rating: 5, authors: ["Judith Herrin"], tags: ["history", "italy"], format: "ebook" });
    await finished("Circe", "2026-03-01", "2026-03-04", { pages: 400, rating: 5, authors: ["Madeline Miller"], tags: ["myth"], format: "audiobook" });
    await finished("Byzantium", "2026-03-05", "2026-03-30", { pages: 150, rating: 3, authors: ["Judith Herrin"], tags: ["history"] });
    await finished("Old Friend", "2026-07-01", "2026-07-10", { pages: 200, rating: 4, sessionNumber: 2 });
    await finished("Last Year", "2025-12-01", "2025-12-20");

    const review = await buildYearReview(2026);
    expect(review.totals).toMatchObject({ books: 4, pages: 1358, rereads: 1, authors: 3, averageRating: 4.3 });
    expect(review.months.map((m) => m.books.map((b) => b.title))).toEqual([
      ["Ravenna"], [], ["Circe", "Byzantium"], [], [], [], ["Old Friend"], [], [], [], [], [],
    ]);
    expect(review.highlights).toMatchObject({
      first: { title: "Ravenna" },
      last: { title: "Old Friend" },
      longest: { title: "Ravenna", pages: 608 },
      shortest: { title: "Byzantium", pages: 150 },
      fastest: { title: "Circe", pagesPerDay: 100 },
      busiestMonth: { month: 3, books: 2 },
    });
    expect(review.highlights.favourites.map((b) => b.title)).toEqual(["Ravenna", "Circe"]);
    expect(review.topAuthors[0]).toEqual({ name: "Judith Herrin", books: 2 });
    expect(review.topTags.slice(0, 2)).toEqual([
      { name: "history", books: 2 },
      { name: "italy", books: 1 },
    ]);
    expect(review.formats).toEqual({ ebook: 1, audiobook: 1, print: 0, unknown: 2 });
  });

  test("an empty year has nothing to highlight", async () => {
    const review = await buildYearReview(2019);
    expect(review.totals.books).toBe(0);
    expect(review.highlights).toEqual({ first: null, last: null, longest: null, shortest: null, fastest: null, favourites: [], busiestMonth: null });
    expect(review.months).toHaveLength(12);
  });

  test("GET /api/stats/review answers for a year and refuses a bad one", async () => {
    expect((await GET(new NextRequest("http://localhost/api/stats/review?year=2026"))).status).toBe(200);
    expect((await GET(new NextRequest("http://localhost/api/stats/review?year=x"))).status).toBe(400);
  });
});
