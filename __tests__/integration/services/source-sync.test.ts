import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { formatInTimeZone } from "date-fns-tz";
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { bookRepository, progressRepository, sessionRepository, sourceLinkRepository } from "@/lib/repositories";
import { BookIndex, SourceSyncService, normalizeIsbn, normalizeTitle, surname } from "@/lib/services/source-sync.service";
import { mapAbsItem, mapAbsProgress } from "@/lib/sources/audiobookshelf";
import { grimmory, mapGrimmoryBooks, resetGrimmoryToken } from "@/lib/sources/grimmory";
import type { ReadingSource, SourceItem } from "@/lib/sources/types";
import type { Book } from "@/lib/db/schema/books";
import { getCurrentUserTimezone } from "@/utils/dateHelpers.server";

/**
 * Progress from reading apps: the apps' answers mapped to items, items matched to Tome books, and the rules for what a
 * sync logs (nothing on the first sync, only what changed after, never backwards, finished means read).
 */

vi.mock("@/lib/calibre-watcher", () => ({
  calibreWatcher: { suspend: () => {}, resume: () => {}, resumeWithIgnorePeriod: () => {} },
}));

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex"
);

/** A reading app whose items the test sets. */
function fakeSource(): ReadingSource & { set(items: SourceItem[]): void } {
  let current: SourceItem[] = [];
  return {
    id: "audiobookshelf",
    name: "Audiobookshelf",
    configured: () => true,
    items: async () => current.map((i) => ({ ...i, title: "" })), // like ABS: details come separately
    details: async (item) => current.find((i) => i.externalId === item.externalId)!,
    cover: async () => PNG,
    set(items) {
      current = items;
    },
  };
}

const item = (id: string, over: Partial<SourceItem> = {}): SourceItem => ({
  externalId: id,
  title: "Piranesi",
  authors: ["Susanna Clarke"],
  progress: 10,
  finished: false,
  ...over,
});

let dataDir: string;
const originalDbPath = process.env.DATABASE_PATH;
let today: string;

beforeAll(async () => {
  await setupTestDatabase(__filename);
});

afterAll(async () => {
  await teardownTestDatabase(__filename);
});

beforeEach(async () => {
  await clearTestDatabase(__filename);
  dataDir = mkdtempSync(join(tmpdir(), "tome-sources-"));
  process.env.DATABASE_PATH = join(dataDir, "tome.db");
  today = formatInTimeZone(new Date(), await getCurrentUserTimezone(), "yyyy-MM-dd");
});

afterEach(() => {
  process.env.DATABASE_PATH = originalDbPath;
  rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function tomeBook(title: string, authors: string[], extra: Partial<Book> = {}) {
  const book = await bookRepository.create({ calibreId: null, source: "manual", path: "", title, authors, totalPages: 200, ...extra });
  await sessionRepository.create({ bookId: book.id, status: "to-read", sessionNumber: 1, isActive: true });
  return book;
}

async function logsOf(bookId: number) {
  const session = await sessionRepository.findActiveByBookId(bookId);
  return session ? progressRepository.findBySessionId(session.id) : [];
}

describe("reading the apps", () => {
  test("Audiobookshelf: books with progress, as a percentage; podcasts and untouched books left out", () => {
    const items = mapAbsProgress({
      mediaProgress: [
        { libraryItemId: "li_1", mediaItemType: "book", duration: 36000, progress: 0.4237, lastUpdate: 1_700_000_000_000 },
        { libraryItemId: "li_2", mediaItemType: "book", duration: 0, ebookProgress: 0.25 },
        { libraryItemId: "li_3", mediaItemType: "book", duration: 100, progress: 1, isFinished: true, finishedAt: 1_700_000_100_000 },
        { libraryItemId: "li_4", mediaItemType: "podcastEpisode", episodeId: "ep", duration: 100, progress: 0.5 },
        { libraryItemId: "li_5", mediaItemType: "book", duration: 100, progress: 0 },
      ],
    });
    expect(items.map((i) => [i.externalId, i.progress, i.finished])).toEqual([
      ["li_1", 42.4, false],
      ["li_2", 25, false],
      ["li_3", 100, true],
    ]);
    expect(items[2]!.finishedAt).toEqual(new Date(1_700_000_100_000));

    const detailed = mapAbsItem(items[0]!, {
      media: {
        metadata: {
          title: "Piranesi",
          authors: [{ id: "a", name: "Susanna Clarke" }],
          isbn: "9781635575637",
          series: [{ name: "Standalone", sequence: "1" }],
        },
      },
    });
    expect(detailed).toMatchObject({ title: "Piranesi", authors: ["Susanna Clarke"], isbn: "9781635575637", series: "Standalone", seriesIndex: 1 });
  });

  test("Grimmory: Kobo progress and read status; physical and unread books left out", () => {
    const items = mapGrimmoryBooks([
      { id: 1, title: "Dune", authors: ["Frank Herbert"], readStatus: "READING", readProgress: 37.5, isbn13: "9780441013593", pageCount: 896 },
      { id: 2, title: "Done", authors: ["A"], readStatus: "READ", readProgress: 98, lastReadTime: "2026-10-01T20:00:00Z" },
      { id: 3, title: "Shelf", authors: ["B"], readStatus: "READING", readProgress: 50, isPhysical: true },
      { id: 4, title: "None", authors: ["C"], readStatus: "PAUSED", readProgress: 0 },
    ]);
    expect(items.map((i) => [i.externalId, i.progress, i.finished])).toEqual([
      ["1", 37.5, false],
      ["2", 100, true],
    ]);
    expect(items[0]).toMatchObject({ isbn: "9780441013593", totalPages: 896 });
    expect(items[1]!.finishedAt).toEqual(new Date("2026-10-01T20:00:00Z"));
  });

  test("Grimmory: signs in once, and again when its token expires", async () => {
    process.env.GRIMMORY_URL = "http://grimmory.test/";
    process.env.GRIMMORY_USERNAME = "brian";
    process.env.GRIMMORY_PASSWORD = "secret";
    resetGrimmoryToken();
    let tokens = 0;
    let expired = false;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/v1/auth/login")) {
        expect(JSON.parse(String(init?.body))).toEqual({ username: "brian", password: "secret" });
        return Response.json({ accessToken: `t${++tokens}` });
      }
      const auth = new Headers(init?.headers).get("authorization");
      if (expired && auth === "Bearer t1") return new Response("", { status: 401 });
      expect(u).toContain("/api/v1/app/books?status=READING&status=RE_READING");
      return Response.json({ content: [{ id: 9, title: "Dune", authors: ["Frank Herbert"], readStatus: "READING", readProgress: 12 }], hasNext: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect((await grimmory.items()).map((i) => i.externalId)).toEqual(["9"]);
      expect((await grimmory.items()).length).toBe(1);
      expect(tokens).toBe(1);
      expired = true;
      expect((await grimmory.items()).length).toBe(1);
      expect(tokens).toBe(2);
    } finally {
      delete process.env.GRIMMORY_URL;
      delete process.env.GRIMMORY_USERNAME;
      delete process.env.GRIMMORY_PASSWORD;
    }
  });
});

describe("matching", () => {
  test("ISBNs, titles and surnames are compared loosely", () => {
    expect(normalizeIsbn("0-441-01359-7")).toBe("9780441013593");
    expect(normalizeIsbn("978-0441013593")).toBe("9780441013593");
    expect(normalizeIsbn("12")).toBeNull();
    expect(normalizeTitle("The Left Hand of Darkness: 50th Anniversary Edition")).toBe("left hand of darkness");
    expect(normalizeTitle("Café & Crème")).toBe("cafe and creme");
    expect(surname("Le Guin, Ursula K.")).toBe("guin");
    expect(surname("Ursula K. Le Guin")).toBe("guin");
    expect(surname("Walter M. Miller Jr.")).toBe("miller");
  });

  test("by ISBN first, then title and an author's surname", async () => {
    const dune = await tomeBook("Dune", ["Frank Herbert"], { isbn: "0441013597" });
    const lhod = await tomeBook("The Left Hand of Darkness", ["Ursula K. Le Guin"]);
    const index = new BookIndex(await bookRepository.findAll());
    expect(index.match(item("x", { title: "Something else", isbn: "9780441013593" }))).toMatchObject({ book: { id: dune.id }, by: "isbn" });
    expect(index.match(item("y", { title: "Left Hand of Darkness (Ace)", authors: ["Le Guin"] }))?.book.id).toBe(lhod.id);
    expect(index.match(item("z", { title: "The Left Hand of Darkness", authors: ["Someone Else"] }))).toBeNull();
  });
});

describe("syncing", () => {
  test("the first sync links what Tome has and logs nothing", async () => {
    const book = await tomeBook("Piranesi", ["Susanna Clarke"]);
    const source = fakeSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.set([item("li_1", { progress: 40 }), item("li_2", { title: "Unknown", authors: ["Nobody"], progress: 70 })]);

    const result = await service.sync("audiobookshelf");
    expect(result).toMatchObject({ baseline: true, items: 2, updated: 0, added: 0 });
    expect(await logsOf(book.id)).toHaveLength(0);
    expect((await sessionRepository.findActiveByBookId(book.id))?.status).toBe("to-read");
    const links = await sourceLinkRepository.findBySource("audiobookshelf");
    expect(links.map((l) => [l.externalId, l.bookId, l.matchedBy])).toEqual([
      ["li_1", book.id, "title"],
      ["li_2", null, null],
    ]);
    expect((await bookRepository.findAll()).length).toBe(1);
  });

  test("after that, new reading is logged, and a day's syncs share one entry", async () => {
    const book = await tomeBook("Piranesi", ["Susanna Clarke"], { totalPages: 200 });
    const source = fakeSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.set([item("li_1", { progress: 40 })]);
    await service.sync("audiobookshelf");

    source.set([item("li_1", { progress: 42.5 })]);
    expect(await service.sync("audiobookshelf")).toMatchObject({ baseline: false, updated: 1 });
    expect((await sessionRepository.findActiveByBookId(book.id))?.status).toBe("reading");
    let logs = await logsOf(book.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ currentPercentage: 42.5, currentPage: 85, progressDate: today, notes: "Synced from Audiobookshelf" });

    source.set([item("li_1", { progress: 55 })]);
    await service.sync("audiobookshelf");
    logs = await logsOf(book.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.currentPercentage).toBe(55);

    // Nothing changed: nothing logged.
    expect(await service.sync("audiobookshelf")).toMatchObject({ updated: 0 });
  });

  test("Tome is never moved backwards", async () => {
    const book = await tomeBook("Piranesi", ["Susanna Clarke"]);
    const source = fakeSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.set([item("li_1", { progress: 10 })]);
    await service.sync("audiobookshelf");
    const { sessionService } = await import("@/lib/services/session.service");
    const { progressService } = await import("@/lib/services/progress.service");
    await sessionService.ensureReadingStatus(book.id);
    await progressService.logProgress(book.id, { currentPercentage: 60, notes: "by hand" });

    source.set([item("li_1", { progress: 30 })]);
    expect(await service.sync("audiobookshelf")).toMatchObject({ updated: 0 });
    expect((await logsOf(book.id)).map((l) => l.currentPercentage)).toEqual([60]);
  });

  test("a book Tome doesn't have is added, with its cover, when there's new reading on it", async () => {
    const source = fakeSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.set([item("li_2", { title: "Unknown", authors: ["Nobody"], totalPages: 120, progress: 70 })]);
    await service.sync("audiobookshelf"); // baseline: not added
    expect(await bookRepository.findAll()).toHaveLength(0);

    source.set([
      item("li_2", { title: "Unknown", authors: ["Nobody"], totalPages: 120, progress: 75 }),
      item("li_3", { title: "Brand New", authors: ["Ann Author"], isbn: "9780441013593", totalPages: 300, progress: 5 }),
    ]);
    expect(await service.sync("audiobookshelf")).toMatchObject({ added: 2, updated: 2 });
    const books = await bookRepository.findAll();
    const added = books.find((b) => b.title === "Brand New")!;
    expect(added).toMatchObject({ source: "audiobookshelf", calibreId: null, isbn: "9780441013593", totalPages: 300 });
    expect(added.coverFile).toMatch(/\.png$/);
    expect((await logsOf(added.id))[0]).toMatchObject({ currentPercentage: 5, currentPage: 15 });
    const links = await sourceLinkRepository.findBySource("audiobookshelf");
    expect(links.find((l) => l.externalId === "li_3")?.matchedBy).toBe("added");
  });

  test("finished in the app means read in Tome, on the day it was finished", async () => {
    const book = await tomeBook("Piranesi", ["Susanna Clarke"]);
    const source = fakeSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.set([item("li_1", { progress: 90 })]);
    await service.sync("audiobookshelf");

    const finishedAt = new Date(Date.now() - 2 * 86_400_000);
    source.set([item("li_1", { progress: 100, finished: true, finishedAt })]);
    expect(await service.sync("audiobookshelf")).toMatchObject({ finished: 1 });
    const sessions = await sessionRepository.findAllByBookId(book.id);
    const read = sessions.find((s) => s.status === "read");
    expect(read?.completedDate).toBe(formatInTimeZone(finishedAt, await getCurrentUserTimezone(), "yyyy-MM-dd"));

    // Still finished on the next sync: nothing more happens.
    expect(await service.sync("audiobookshelf")).toMatchObject({ updated: 0 });
  });

  test("a book without a page count waits for one, then catches up", async () => {
    const book = await tomeBook("Piranesi", ["Susanna Clarke"], { totalPages: null });
    const source = fakeSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.set([item("li_1", { progress: 10 })]);
    await service.sync("audiobookshelf");

    source.set([item("li_1", { progress: 30 })]);
    const waiting = await service.sync("audiobookshelf");
    expect(waiting).toMatchObject({ needPages: 1, updated: 0 });
    expect(waiting.summary).toContain("1 waiting for a page count");
    expect(await logsOf(book.id)).toHaveLength(0);
    expect((await sessionRepository.findActiveByBookId(book.id))?.status).toBe("to-read");

    await bookRepository.update(book.id, { totalPages: 250 });
    expect(await service.sync("audiobookshelf")).toMatchObject({ updated: 1, needPages: 0 });
    expect((await logsOf(book.id)).map((l) => l.currentPercentage)).toEqual([30]);
  });

  test("a wrong match can be pointed at the right book", async () => {
    const wrong = await tomeBook("Piranesi", ["Susanna Clarke"]);
    const right = await tomeBook("Piranesi (audiobook)", ["Susanna Clarke"]);
    const source = fakeSource();
    const service = new SourceSyncService({ audiobookshelf: source, grimmory: source });
    source.set([item("li_1", { progress: 10 })]);
    await service.sync("audiobookshelf");
    const [link] = await sourceLinkRepository.findBySource("audiobookshelf");
    expect(link!.bookId).toBe(wrong.id);

    expect(await service.relink(link!.id, { bookId: right.id })).toMatchObject({ bookId: right.id, matchedBy: "person" });
    source.set([item("li_1", { progress: 20 })]);
    await service.sync("audiobookshelf");
    expect(await logsOf(wrong.id)).toHaveLength(0);
    expect((await logsOf(right.id)).map((l) => l.currentPercentage)).toEqual([20]);
  });
});
