import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { bookRepository, sessionRepository, sourceLinkRepository } from "@/lib/repositories";
import { SourceSyncService } from "@/lib/services/source-sync.service";
import { manualBookService } from "@/lib/services/manual-book.service";
import { grimmory, koboShelfBooks, koboShelfStatus, resetGrimmoryToken } from "@/lib/sources/grimmory";
import type { ReadingSource, SourceItem } from "@/lib/sources/types";

/**
 * Grimmory's Kobo shelf as Tome's backlog: books on the shelf are put in the pile (or read-next) once, matched to a
 * Tome book or added; taking a book off the shelf, or out of Tome, isn't undone by the next sync.
 */

vi.mock("@/lib/calibre-watcher", () => ({
  calibreWatcher: { suspend: () => {}, resume: () => {}, resumeWithIgnorePeriod: () => {} },
}));

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex"
);

/** A Grimmory-like source with no reading on anything, and a Kobo shelf the test sets. */
function shelfSource(status: "to-read" | "read-next" = "to-read"): ReadingSource & { shelve(items: SourceItem[]): void } {
  let shelf: SourceItem[] = [];
  return {
    id: "grimmory",
    name: "Grimmory",
    configured: () => true,
    items: async () => [],
    details: async (item) => item,
    cover: async () => PNG,
    backlog: { name: "the Kobo shelf", status, items: async () => shelf },
    shelve(items) {
      shelf = items;
    },
  };
}

const onShelf = (id: string, title: string, authors: string[], over: Partial<SourceItem> = {}): SourceItem => ({
  externalId: id,
  title,
  authors,
  progress: 0,
  finished: false,
  format: "ebook",
  ...over,
});

let dataDir: string;
const originalDbPath = process.env.DATABASE_PATH;

beforeAll(async () => {
  await setupTestDatabase(__filename);
});
afterAll(async () => {
  await teardownTestDatabase(__filename);
});
beforeEach(async () => {
  await clearTestDatabase(__filename);
  dataDir = mkdtempSync(join(tmpdir(), "tome-kobo-"));
  process.env.DATABASE_PATH = join(dataDir, "tome.db");
});
afterEach(() => {
  process.env.DATABASE_PATH = originalDbPath;
  rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function tomeBook(title: string, authors: string[], status?: "to-read" | "reading" | "read" | "dnf") {
  const book = await bookRepository.create({ calibreId: Math.floor(Math.random() * 1e6), source: "calibre", path: "x", title, authors, totalPages: 300 });
  if (status) {
    const done = status === "read" || status === "dnf";
    await sessionRepository.create({ bookId: book.id, status, sessionNumber: 1, isActive: !done, ...(done && { completedDate: "2026-01-01" }) });
  }
  return book;
}

const statusOf = async (bookId: number) => (await sessionRepository.findActiveByBookId(bookId))?.status ?? null;

describe("the Kobo shelf", () => {
  test("puts the shelf's books in the backlog: Tome's own book if it has it, else a new one with its cover", async () => {
    const dune = await tomeBook("Dune", ["Frank Herbert"]); // in Tome with no reading yet
    const source = shelfSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.shelve([
      onShelf("1", "Dune", ["Frank Herbert"]),
      onShelf("2", "Piranesi", ["Susanna Clarke"], { isbn: "9781635575637", totalPages: 272 }),
    ]);

    const result = await service.sync("grimmory");
    expect(result).toMatchObject({ queued: 2, added: 1 });
    expect(result.summary).toContain("2 book(s) from the Kobo shelf put in the backlog");
    expect(await statusOf(dune.id)).toBe("to-read");

    const piranesi = (await bookRepository.findAll()).find((b) => b.title === "Piranesi")!;
    expect(piranesi).toMatchObject({ source: "grimmory", isbn: "9781635575637", totalPages: 272 });
    expect(piranesi.coverFile).toBeTruthy();
    expect(await statusOf(piranesi.id)).toBe("to-read");
  });

  test("with read-next, new books join the end of the queue; books already in the backlog stay put", async () => {
    const pile = await tomeBook("Dune", ["Frank Herbert"], "to-read");
    const source = shelfSource("read-next");
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.shelve([onShelf("1", "Dune", ["Frank Herbert"]), onShelf("2", "Hyperion", ["Dan Simmons"])]);
    expect(await service.sync("grimmory")).toMatchObject({ queued: 1, added: 1 });

    expect(await statusOf(pile.id)).toBe("to-read");
    const hyperion = (await bookRepository.findAll()).find((b) => b.title === "Hyperion")!;
    expect(await statusOf(hyperion.id)).toBe("read-next");
  });

  test("books being read, finished or dropped are left alone", async () => {
    const reading = await tomeBook("Dune", ["Frank Herbert"], "reading");
    const read = await tomeBook("Circe", ["Madeline Miller"], "read");
    const dropped = await tomeBook("Ulysses", ["James Joyce"], "dnf");
    const source = shelfSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.shelve([onShelf("1", "Dune", ["Frank Herbert"]), onShelf("2", "Circe", ["Madeline Miller"]), onShelf("3", "Ulysses", ["James Joyce"])]);

    expect(await service.sync("grimmory")).toMatchObject({ queued: 0, added: 0 });
    expect(await statusOf(reading.id)).toBe("reading");
    expect(await sessionRepository.findActiveByBookId(read.id)).toBeUndefined();
    expect(await sessionRepository.findActiveByBookId(dropped.id)).toBeUndefined();
  });

  test("taking a book off the shelf leaves it in Tome; a book removed from Tome isn't brought back", async () => {
    const source = shelfSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.shelve([onShelf("1", "Piranesi", ["Susanna Clarke"]), onShelf("2", "Hyperion", ["Dan Simmons"])]);
    await service.sync("grimmory");
    const [piranesi, hyperion] = ["Piranesi", "Hyperion"].map((t) => t);
    const books = await bookRepository.findAll();
    const p = books.find((b) => b.title === piranesi)!;
    const h = books.find((b) => b.title === hyperion)!;

    // Piranesi comes off the Kobo shelf: it stays in Tome's pile.
    source.shelve([onShelf("2", "Hyperion", ["Dan Simmons"])]);
    expect(await service.sync("grimmory")).toMatchObject({ queued: 0, added: 0 });
    expect(await statusOf(p.id)).toBe("to-read");

    // Hyperion is removed from Tome while still on the shelf: the next syncs don't add it back.
    await manualBookService.remove(h.id);
    expect(await service.sync("grimmory")).toMatchObject({ queued: 0, added: 0 });
    expect((await bookRepository.findAll()).map((b) => b.title)).toEqual(["Piranesi"]);
    expect((await sourceLinkRepository.findItem("grimmory", "2"))?.queuedAt).toBeInstanceOf(Date);
  });

  test("a book read on the Kobo and on the shelf is logged as reading, not queued", async () => {
    const dune = await tomeBook("Dune", ["Frank Herbert"]);
    let reading: SourceItem[] = [];
    const source = shelfSource();
    source.items = async () => reading;
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    await service.sync("grimmory"); // first sync: nothing on the shelf, no reading

    reading = [onShelf("1", "Dune", ["Frank Herbert"], { progress: 20 })];
    source.shelve([onShelf("1", "Dune", ["Frank Herbert"], { progress: 20 })]);
    expect(await service.sync("grimmory")).toMatchObject({ updated: 1, queued: 0 });
    expect(await statusOf(dune.id)).toBe("reading");
  });
});

describe("reading the Kobo shelf from Grimmory", () => {
  test("GRIMMORY_KOBO_SHELF picks the pile, read-next or off", () => {
    expect(koboShelfStatus(undefined)).toBe("to-read");
    expect(koboShelfStatus("read-next")).toBe("read-next");
    expect(koboShelfStatus(" Read-Next ")).toBe("read-next");
    expect(koboShelfStatus("off")).toBeNull();
    expect(koboShelfStatus("false")).toBeNull();
  });

  test("finds the shelf named Kobo and pages through its books, unread ones included, physical ones left out", async () => {
    process.env.GRIMMORY_URL = "http://grimmory.test/";
    process.env.GRIMMORY_USERNAME = "brian";
    process.env.GRIMMORY_PASSWORD = "secret";
    resetGrimmoryToken();
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        asked.push(u.replace("http://grimmory.test", ""));
        if (u.endsWith("/api/v1/auth/login")) return Response.json({ accessToken: "t" });
        if (u.endsWith("/api/v1/app/shelves")) return Response.json([{ id: 3, name: "Favourites" }, { id: 7, name: "Kobo" }]);
        if (u.includes("shelfId=7&page=0")) {
          return Response.json({
            content: [
              { id: 1, title: "Piranesi", authors: ["Susanna Clarke"], readStatus: "UNREAD", readProgress: 0, isbn13: "9781635575637", pageCount: 272 },
              { id: 2, title: "Paper Copy", authors: ["Someone"], isPhysical: true },
            ],
            hasNext: true,
          });
        }
        if (u.includes("shelfId=7&page=1")) return Response.json({ content: [{ id: 3, title: "Hyperion", authors: ["Dan Simmons"], readProgress: 15 }], hasNext: false });
        return new Response("", { status: 404 });
      })
    );
    try {
      const items = await koboShelfBooks();
      expect(items.map((i) => [i.externalId, i.title, i.progress])).toEqual([
        ["1", "Piranesi", 0],
        ["3", "Hyperion", 15],
      ]);
      expect(items[0]).toMatchObject({ isbn: "9781635575637", totalPages: 272 });
      expect(asked).toContain("/api/v1/app/books?shelfId=7&page=0&size=50");
      expect(grimmory.backlog).toMatchObject({ name: "the Kobo shelf", status: "to-read" });

      process.env.GRIMMORY_KOBO_SHELF = "off";
      expect(grimmory.backlog).toBeUndefined();
    } finally {
      delete process.env.GRIMMORY_URL;
      delete process.env.GRIMMORY_USERNAME;
      delete process.env.GRIMMORY_PASSWORD;
      delete process.env.GRIMMORY_KOBO_SHELF;
    }
  });

  test("no Kobo shelf, no books", async () => {
    process.env.GRIMMORY_URL = "http://grimmory.test/";
    process.env.GRIMMORY_USERNAME = "brian";
    process.env.GRIMMORY_PASSWORD = "secret";
    resetGrimmoryToken();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => (String(url).endsWith("/login") ? Response.json({ accessToken: "t" }) : Response.json([{ id: 3, name: "Favourites" }])))
    );
    try {
      expect(await koboShelfBooks()).toEqual([]);
    } finally {
      delete process.env.GRIMMORY_URL;
      delete process.env.GRIMMORY_USERNAME;
      delete process.env.GRIMMORY_PASSWORD;
    }
  });
});
