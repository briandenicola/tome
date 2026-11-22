import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { bookRepository, sessionRepository, progressRepository, sourceLinkRepository } from "@/lib/repositories";
import { shelfRepository } from "@/lib/repositories/shelf.repository";
import { POST as BULK_DELETE } from "@/app/api/books/bulk-delete/route";
import { GET as IDS } from "@/app/api/books/ids/route";
import { GET as LIST } from "@/app/api/books/route";

/**
 * Bulk actions from the library: the ids of every book matching the filters (for "select all"), and deleting many
 * books at once, which removes books Tome owns and leaves Calibre's alone.
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

let calibreId = 1;

async function book(title: string, source: "calibre" | "manual" | "audiobookshelf", extra: Record<string, unknown> = {}) {
  const b = await bookRepository.create({
    calibreId: source === "calibre" ? calibreId++ : null,
    source,
    path: source === "calibre" ? "x" : "",
    title,
    authors: ["Someone"],
    totalPages: 300,
    ...extra,
  });
  await sessionRepository.create({ bookId: b.id, status: "to-read", sessionNumber: 1, isActive: true });
  return b;
}

const bulkDelete = (body: unknown) =>
  BULK_DELETE(
    new NextRequest("http://localhost/api/books/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

describe("GET /api/books/ids", () => {
  test("returns every matching book, past the page the library loads", async () => {
    for (let i = 0; i < 60; i++) await book(`Tagged ${i}`, "manual", { tags: ["history"] });
    await book("Untagged", "manual");

    const res = await IDS(new NextRequest("http://localhost/api/books/ids?tags=history"));
    const data = await res.json();
    expect(data.total).toBe(60);
    expect(data.ids).toHaveLength(60);

    const page = await (await LIST(new NextRequest("http://localhost/api/books?tags=history"))).json();
    expect(page.books).toHaveLength(50);
    expect(data.ids).toEqual(expect.arrayContaining(page.books.map((b: { id: number }) => b.id)));
  });

  test("reads the same filters as the library list: search and shelf", async () => {
    const a = await book("Ravenna", "calibre");
    const b = await book("Rome", "manual");
    const shelf = await shelfRepository.create({ name: "Audiobooks" });
    await shelfRepository.addBookToShelf(shelf.id, b.id);

    const bySearch = await (await IDS(new NextRequest("http://localhost/api/books/ids?search=raven"))).json();
    expect(bySearch.ids).toEqual([a.id]);
    const byShelf = await (await IDS(new NextRequest(`http://localhost/api/books/ids?shelf=${shelf.id}`))).json();
    expect(byShelf.ids).toEqual([b.id]);
  });
});

describe("POST /api/books/bulk-delete", () => {
  test("removes Tome's own books with their sessions, progress and shelf places, and skips Calibre's", async () => {
    const manual = await book("Piranesi", "manual");
    const listened = await book("The Rest Is History", "audiobookshelf");
    const calibre = await book("Dune", "calibre");
    const session = await sessionRepository.findActiveByBookId(manual.id);
    await sessionRepository.update(session!.id, { status: "reading" });
    await progressRepository.create({ bookId: manual.id, sessionId: session!.id, currentPage: 10, currentPercentage: 3, progressDate: "2026-11-20", pagesRead: 10 });
    const shelf = await shelfRepository.create({ name: "Favourites" });
    await shelfRepository.addBookToShelf(shelf.id, manual.id);
    await shelfRepository.addBookToShelf(shelf.id, calibre.id);
    const link = await sourceLinkRepository.create({ source: "audiobookshelf", externalId: "li_1", bookId: listened.id, title: "The Rest Is History" });

    const res = await bulkDelete({ bookIds: [manual.id, listened.id, calibre.id, 99999] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: [manual.id, listened.id], skippedCalibre: [calibre.id], missing: [99999] });

    expect(await bookRepository.findById(manual.id)).toBeUndefined();
    expect(await bookRepository.findById(listened.id)).toBeUndefined();
    expect(await bookRepository.findById(calibre.id)).toBeDefined();
    expect(await sessionRepository.findAllByBookId(manual.id)).toEqual([]);
    expect(await progressRepository.findByBookId(manual.id)).toEqual([]);
    expect(await shelfRepository.isBookOnShelf(shelf.id, manual.id)).toBe(false);
    expect(await shelfRepository.isBookOnShelf(shelf.id, calibre.id)).toBe(true);
    expect((await sourceLinkRepository.findById(link.id))?.bookId).toBeNull();
  });

  test("refuses a body without book ids", async () => {
    for (const body of [{}, { bookIds: [] }, { bookIds: ["1"] }, { bookIds: [1.5] }, "not json"]) {
      expect((await bulkDelete(body)).status).toBe(400);
    }
  });
});
