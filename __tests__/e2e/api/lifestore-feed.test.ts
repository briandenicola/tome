import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { bookRepository, progressRepository, sessionRepository } from "@/lib/repositories";
import { GET } from "@/app/api/lifestore/records/route";
import { plainText } from "@/lib/services/lifestore-feed.service";
import { proxyAuthCheck } from "@/lib/auth";

/**
 * The life store feed: books with reading on them, a page at a time, each with its reads and progress, in the
 * contract the life store's records-feed adapter reads.
 */

beforeAll(async () => {
  await setupTestDatabase(__filename);
});

afterAll(async () => {
  await teardownTestDatabase(__filename);
});

beforeEach(async () => {
  await clearTestDatabase(__filename);
});

const feed = async (query = "") => {
  const res = await GET(new NextRequest(`http://localhost/api/lifestore/records${query}`));
  return { status: res.status, body: await res.json() };
};

async function book(title: string, extra: Record<string, unknown> = {}) {
  return bookRepository.create({ calibreId: null, source: "manual", path: "", title, authors: ["Ursula K. Le Guin"], totalPages: 300, ...extra });
}

describe("GET /api/lifestore/records", () => {
  test("lists books with reading on them, with their reads and progress", async () => {
    const pile = await book("On the pile");
    await sessionRepository.create({ bookId: pile.id, status: "to-read", sessionNumber: 1, isActive: true });

    const lhod = await book("The Left Hand of Darkness", {
      description: "<p>A <b>classic</b> of science fiction &amp; gender.</p><p>Winter&#8217;s king.</p>",
      rating: 5,
      series: "Hainish Cycle",
      seriesIndex: 4,
      pubDate: new Date("1969-03-01T00:00:00Z"),
    });
    const first = await sessionRepository.create({
      bookId: lhod.id, status: "read", sessionNumber: 1, isActive: false, startedDate: "2025-01-02", completedDate: "2025-01-20", review: " Cold and kind. ",
    });
    await progressRepository.create({ bookId: lhod.id, sessionId: first.id, currentPage: 120, currentPercentage: 40, progressDate: "2025-01-05", pagesRead: 120, notes: "Ekumen!" });
    await progressRepository.create({ bookId: lhod.id, sessionId: first.id, currentPage: 300, currentPercentage: 100, progressDate: "2025-01-20", pagesRead: 180 });
    const second = await sessionRepository.create({ bookId: lhod.id, status: "reading", sessionNumber: 2, isActive: true, startedDate: "2026-11-01" });
    await progressRepository.create({ bookId: lhod.id, sessionId: second.id, currentPage: 30, currentPercentage: 10, progressDate: "2026-11-02", pagesRead: 30, notes: "Synced from Grimmory" });

    const dropped = await book("Dropped");
    await sessionRepository.create({ bookId: dropped.id, status: "dnf", sessionNumber: 1, isActive: false, startedDate: "2026-02-01", completedDate: "2026-02-10" });

    const { status, body } = await feed();
    expect(status).toBe(200);
    expect(body.next).toBe("");
    expect(body.records.map((r: { id: string }) => r.id)).toEqual([String(lhod.id), String(dropped.id)]);

    const rec = body.records[0];
    expect(rec).toMatchObject({ kind: "book", id: String(lhod.id) });
    expect(Date.parse(rec.updatedAt)).not.toBeNaN();
    expect(rec.data).toMatchObject({
      title: "The Left Hand of Darkness",
      authors: ["Ursula K. Le Guin"],
      totalPages: 300,
      rating: 5,
      series: "Hainish Cycle",
      seriesIndex: 4,
      pubDate: "1969-03-01",
      source: "manual",
      description: "A classic of science fiction & gender.\nWinter’s king.",
    });
    expect(rec.data.sessions).toEqual([
      { id: first.id, number: 1, status: "read", startedDate: "2025-01-02", completedDate: "2025-01-20", review: "Cold and kind." },
      { id: second.id, number: 2, status: "reading", startedDate: "2026-11-01", completedDate: null, review: null },
    ]);
    expect(rec.data.progress.map((p: { date: string; pagesRead: number; notes: string | null }) => [p.date, p.pagesRead, p.notes])).toEqual([
      ["2025-01-05", 120, "Ekumen!"],
      ["2025-01-20", 180, null],
      ["2026-11-02", 30, "Synced from Grimmory"],
    ]);
    expect(rec.data.progress[0]).toMatchObject({ sessionId: first.id, page: 120, percentage: 40 });
  });

  test("pages through every book exactly once", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const b = await book(`Book ${i}`);
      await sessionRepository.create({ bookId: b.id, status: "reading", sessionNumber: 1, isActive: true, startedDate: "2026-01-01" });
      ids.push(String(b.id));
    }
    const seen: string[] = [];
    let token = "";
    for (let pages = 0; pages < 10; pages++) {
      const { body } = await feed(`?limit=2${token ? `&page=${token}` : ""}`);
      seen.push(...body.records.map((r: { id: string }) => r.id));
      if (!body.next) break;
      token = body.next;
    }
    expect(seen).toEqual(ids);
  });

  test("bad paging is refused plainly", async () => {
    expect((await feed("?page=abc")).status).toBe(400);
    expect((await feed("?limit=0")).body.error).toBe("limit is a whole number from 1 to 500.");
  });

  test("a read-only API token may read it", async () => {
    const original = process.env.AUTH_PASSWORD;
    process.env.AUTH_PASSWORD = "pw";
    try {
      const req = new NextRequest("http://localhost/api/lifestore/records", { headers: { authorization: "Bearer tome_x" } });
      expect(await proxyAuthCheck(req, async () => "read")).toBeNull();
    } finally {
      if (original === undefined) delete process.env.AUTH_PASSWORD;
      else process.env.AUTH_PASSWORD = original;
    }
  });

  test("descriptions lose their HTML", () => {
    expect(plainText("<div>One<br/>Two &lt;3</div>")).toBe("One\nTwo <3");
    expect(plainText("   ")).toBeNull();
    expect(plainText(null)).toBeNull();
  });
});
