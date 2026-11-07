import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { bookRepository, sessionRepository } from "@/lib/repositories";
import { POST as CREATE } from "@/app/api/books/manual/route";
import { PATCH, DELETE } from "@/app/api/books/manual/[id]/route";
import { PUT as PUT_COVER, DELETE as DELETE_COVER } from "@/app/api/books/manual/[id]/cover/route";
import { GET as GET_COVER } from "@/app/api/books/[id]/cover/route";
import { GET as LOOKUP } from "@/app/api/books/lookup/route";
import { GET as LIST } from "@/app/api/books/route";
import { bookService } from "@/lib/services/book.service";
import { tagService } from "@/lib/services/tag.service";
import { mapOpenLibrary, normalizePublishDate } from "@/lib/services/isbn-lookup.service";
import { coverCache } from "@/lib/cache/cover-cache";
import dune from "../../fixtures/openlibrary-dune.json";

/**
 * Books added by hand (no Calibre): adding, changing and removing them, their covers, the ISBN lookup, and that
 * nothing about them ever reaches Calibre.
 */

// Any Calibre write fails: a book added by hand must never get that far.
const calibreCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/services/calibre.service", () => {
  const fail = () => {
    calibreCalls.count++;
    throw new Error("Calibre isn't set up");
  };
  return {
    calibreService: { batchUpdateTags: fail, updateTags: fail, updateRating: fail, readTags: () => [], readRating: () => null },
    CalibreService: class {},
  };
});
vi.mock("@/lib/calibre-watcher", () => ({
  calibreWatcher: { suspend: () => {}, resume: () => {}, resumeWithIgnorePeriod: () => {} },
}));

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex"
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);

const json = (method: string, url: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

async function addBook(body: Record<string, unknown> = { title: "Piranesi", authors: ["Susanna Clarke"], totalPages: 272 }) {
  const res = await CREATE(json("POST", "http://localhost/api/books/manual", body));
  return { res, book: await res.json() };
}

function uploadCover(id: number, bytes: Buffer, type = "image/png") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), "cover");
  return PUT_COVER(new NextRequest(`http://localhost/api/books/manual/${id}/cover`, { method: "PUT", body: form }), params(id));
}

let dataDir: string;
const originalDbPath = process.env.DATABASE_PATH;
const originalCalibre = process.env.CALIBRE_DB_PATH;

beforeAll(async () => {
  await setupTestDatabase(__filename);
});

afterAll(async () => {
  await teardownTestDatabase(__filename);
});

beforeEach(async () => {
  await clearTestDatabase(__filename);
  dataDir = mkdtempSync(join(tmpdir(), "tome-covers-"));
  process.env.DATABASE_PATH = join(dataDir, "tome.db");
  delete process.env.CALIBRE_DB_PATH;
  coverCache.clear();
  calibreCalls.count = 0;
});

afterEach(() => {
  process.env.DATABASE_PATH = originalDbPath;
  if (originalCalibre === undefined) delete process.env.CALIBRE_DB_PATH;
  else process.env.CALIBRE_DB_PATH = originalCalibre;
  rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("adding a book by hand", () => {
  test("it has no Calibre id, starts as to-read and shows in the library", async () => {
    const { res, book } = await addBook({
      title: "  Piranesi ",
      authors: ["Susanna Clarke", "susanna clarke", " "],
      totalPages: "272",
      isbn: "978-1-63557-563-4",
      pubDate: "2020-09",
      tags: "fantasy, Fantasy, mystery",
    });
    expect(res.status).toBe(201);
    expect(book).toMatchObject({
      title: "Piranesi",
      authors: ["Susanna Clarke"],
      authorSort: "Clarke, Susanna",
      totalPages: 272,
      isbn: "9781635575634",
      tags: ["fantasy", "mystery"],
      source: "manual",
      calibreId: null,
      path: "",
    });
    expect(new Date(book.pubDate).toISOString()).toBe("2020-09-01T00:00:00.000Z");

    const session = await sessionRepository.findActiveByBookId(book.id);
    expect(session).toMatchObject({ status: "to-read", sessionNumber: 1, isActive: true });

    const list = await (await LIST(new NextRequest("http://localhost/api/books"))).json();
    expect(list.books.map((b: { id: number }) => b.id)).toContain(book.id);
  });

  test("two books by hand can sit beside Calibre books", async () => {
    await bookRepository.create({ calibreId: 1, title: "Dune", authors: ["Frank Herbert"], path: "Frank Herbert/Dune (1)" });
    expect((await addBook({ title: "One" })).res.status).toBe(201);
    expect((await addBook({ title: "Two" })).res.status).toBe(201);
    expect(await bookRepository.countFromCalibre()).toBe(1);
  });

  test("bad details are refused with what to change", async () => {
    for (const [body, message] of [
      [{ title: " " }, "Give the book a title."],
      [{ title: "x".repeat(501) }, "Keep the title under 500 characters."],
      [{ title: "A", totalPages: 0 }, "Pages must be a whole number from 1 to 100000."],
      [{ title: "A", totalPages: 12.5 }, "Pages must be a whole number from 1 to 100000."],
      [{ title: "A", isbn: "12345" }, "The ISBN must have 10 or 13 digits."],
      [{ title: "A", pubDate: "last spring" }, "The publication date must look like 2024, 2024-05 or 2024-05-17."],
      [{ title: "A", authors: [3] }, "Authors must be a list of names."],
    ] as const) {
      const { res, book } = await addBook(body);
      expect(res.status).toBe(400);
      expect(book.error).toBe(message);
    }
    const notJson = await CREATE(new NextRequest("http://localhost/api/books/manual", { method: "POST", body: "nope" }));
    expect(notJson.status).toBe(400);
  });
});

describe("changing and removing a book added by hand", () => {
  test("only the fields sent change", async () => {
    const { book } = await addBook({ title: "Piranesi", authors: ["Susanna Clarke"], totalPages: 272 });
    const res = await PATCH(json("PATCH", "http://localhost/x", { totalPages: 245, series: "Standalone" }), params(book.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "Piranesi", authors: ["Susanna Clarke"], totalPages: 245, series: "Standalone" });
  });

  test("a Calibre book is changed in Calibre, so it's refused", async () => {
    const calibre = await bookRepository.create({ calibreId: 9, title: "Dune", authors: [], path: "p" });
    const patch = await PATCH(json("PATCH", "http://localhost/x", { title: "Dune!" }), params(calibre.id));
    expect(patch.status).toBe(409);
    expect((await patch.json()).error).toMatch(/comes from Calibre/);
    expect((await DELETE(json("DELETE", "http://localhost/x"), params(calibre.id))).status).toBe(409);
    expect((await uploadCover(calibre.id, PNG)).status).toBe(409);
    expect((await bookRepository.findById(calibre.id))?.title).toBe("Dune");
  });

  test("removing takes its sessions and cover with it", async () => {
    const { book } = await addBook();
    await uploadCover(book.id, PNG);
    expect(readdirSync(join(dataDir, "covers"))).toHaveLength(1);

    const res = await DELETE(json("DELETE", "http://localhost/x"), params(book.id));
    expect(res.status).toBe(200);
    expect(await bookRepository.findById(book.id)).toBeUndefined();
    expect(await sessionRepository.findActiveByBookId(book.id)).toBeFalsy();
    expect(readdirSync(join(dataDir, "covers"))).toHaveLength(0);

    expect((await DELETE(json("DELETE", "http://localhost/x"), params(book.id))).status).toBe(404);
    expect((await DELETE(json("DELETE", "http://localhost/x"), params("abc"))).status).toBe(400);
  });

  test("its rating and tags stay in Tome and never reach Calibre", async () => {
    const { book } = await addBook();
    await bookService.updateRating(book.id, 4);
    await tagService.updateBookTags(book.id, ["favourites"]);
    await tagService.renameTag("favourites", "faves");
    expect(await bookRepository.findById(book.id)).toMatchObject({ rating: 4, tags: ["faves"] });
    expect(calibreCalls.count).toBe(0);
  });

  test("a Calibre sync never orphans it", async () => {
    const calibre = await bookRepository.create({ calibreId: 5, title: "Gone", authors: [], path: "p" });
    const { book } = await addBook();
    const orphans = await bookRepository.findNotInCalibreIds([6]);
    expect(orphans.map((b) => b.id)).toEqual([calibre.id]);
    expect(orphans.map((b) => b.id)).not.toContain(book.id);
  });
});

describe("covers of books added by hand", () => {
  test("an upload is kept next to the database and served by Tome book id", async () => {
    const { book } = await addBook();
    const res = await uploadCover(book.id, PNG);
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.coverFile).toMatch(new RegExp(`^${book.id}-[0-9a-f]{8}\\.png$`));
    expect(new Date(saved.lastSynced).getTime()).toBeGreaterThanOrEqual(new Date(book.lastSynced).getTime());
    expect(readFileSync(join(dataDir, "covers", saved.coverFile))).toEqual(PNG);

    const cover = await GET_COVER(new NextRequest(`http://localhost/api/books/${book.id}/cover`), params(book.id));
    expect(cover.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await cover.arrayBuffer())).toEqual(PNG);
  });

  test("a new cover replaces the old file and the cached image", async () => {
    const { book } = await addBook();
    const first = await (await uploadCover(book.id, PNG)).json();
    await GET_COVER(new NextRequest("http://localhost/x"), params(book.id)); // now cached
    const second = await (await uploadCover(book.id, JPEG, "image/jpeg")).json();
    expect(second.coverFile).not.toBe(first.coverFile);
    expect(readdirSync(join(dataDir, "covers"))).toEqual([second.coverFile]);
    const cover = await GET_COVER(new NextRequest("http://localhost/x"), params(book.id));
    expect(cover.headers.get("content-type")).toBe("image/jpeg");
  });

  test("only images are taken, judged by their bytes", async () => {
    const { book } = await addBook();
    const res = await uploadCover(book.id, Buffer.from("<svg onload=alert(1)>"), "image/png");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("The cover isn't a JPEG, PNG, GIF or WebP image.");
    const big = await uploadCover(book.id, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
    expect((await big.json()).error).toBe("The cover is over 5 MB. Choose a smaller image.");
  });

  test("a cover can come from a web address", async () => {
    const { book } = await addBook();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(JPEG), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await PUT_COVER(json("PUT", "http://localhost/x", { url: "https://covers.example.com/p.jpg" }), params(book.id));
    expect(res.status).toBe(200);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://covers.example.com/p.jpg");
    expect((await res.json()).coverFile).toMatch(/\.jpg$/);

    const notWeb = await PUT_COVER(json("PUT", "http://localhost/x", { url: "file:///etc/passwd" }), params(book.id));
    expect(notWeb.status).toBe(400);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    const missing = await PUT_COVER(json("PUT", "http://localhost/x", { url: "https://covers.example.com/x.jpg" }), params(book.id));
    expect(missing.status).toBe(502);
    expect((await missing.json()).error).toMatch(/covers\.example\.com answered 404/);
  });

  test("removing the cover brings the placeholder back", async () => {
    const { book } = await addBook();
    await uploadCover(book.id, PNG);
    const res = await DELETE_COVER(json("DELETE", "http://localhost/x"), params(book.id));
    expect((await res.json()).coverFile).toBeNull();
    const cover = await GET_COVER(new NextRequest("http://localhost/x"), params(book.id));
    const placeholder = readFileSync(join(process.cwd(), "public", "cover-fallback.png"));
    expect(Buffer.from(await cover.arrayBuffer()).equals(placeholder)).toBe(true);
  });

  test("a Calibre book's cover with no Calibre set up is the placeholder", async () => {
    const calibre = await bookRepository.create({ calibreId: 3, title: "Dune", authors: [], path: "p" });
    const cover = await GET_COVER(new NextRequest("http://localhost/x"), params(calibre.id));
    expect(cover.headers.get("content-type")).toBe("image/png");
  });
});

describe("ISBN lookup", () => {
  test("maps Open Library's answer to the form", () => {
    expect(mapOpenLibrary("9780441013593", dune["ISBN:9780441013593"])).toEqual({
      isbn: "9780441013593",
      title: "Dune",
      authors: ["Frank Herbert"],
      totalPages: 896,
      publisher: "Ace",
      pubDate: "2005",
      coverUrl: "https://covers.openlibrary.org/b/id/15265842-L.jpg",
    });
    expect(mapOpenLibrary("1", undefined)).toBeNull();
    expect(mapOpenLibrary("1", { authors: [] })).toBeNull();
  });

  test("reads Open Library's free-text dates", () => {
    expect(normalizePublishDate("2005")).toBe("2005");
    expect(normalizePublishDate("2010-05-17")).toBe("2010-05-17");
    expect(normalizePublishDate("May 17, 2010")).toBe("2010-05-17");
    expect(normalizePublishDate("September 2020")).toBe("2020-09");
    expect(normalizePublishDate("unknown")).toBeUndefined();
  });

  test("asks Open Library once, and says plainly when it can't help", async () => {
    const fetchMock = vi.fn(async () => Response.json(dune));
    vi.stubGlobal("fetch", fetchMock);
    const ok = await LOOKUP(new NextRequest("http://localhost/api/books/lookup?isbn=978-0441-013593"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).title).toBe("Dune");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      "https://openlibrary.org/api/books?bibkeys=ISBN:9780441013593&format=json&jscmd=data"
    );

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const unknown = await LOOKUP(new NextRequest("http://localhost/api/books/lookup?isbn=9780000000002"));
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error).toBe("Open Library doesn't know that ISBN. Fill in the details yourself.");

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const down = await LOOKUP(new NextRequest("http://localhost/api/books/lookup?isbn=9780441013593"));
    expect(down.status).toBe(502);

    const bad = await LOOKUP(new NextRequest("http://localhost/api/books/lookup?isbn=12"));
    expect(bad.status).toBe(400);
  });
});
