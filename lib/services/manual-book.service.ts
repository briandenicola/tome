import { bookRepository, sessionRepository } from "@/lib/repositories";
import type { Book } from "@/lib/db/schema/books";
import { generateAuthorSort } from "@/lib/utils/author-sort";
import { CoverError, MAX_COVER_BYTES, deleteCover, saveCover } from "@/lib/covers/manual-covers";
import { coverCache } from "@/lib/cache/cover-cache";
import { getLogger } from "@/lib/logger";

/**
 * Books added by hand: for a Kobo, an audiobook or a book on the shelf, with no Calibre library behind it. Tome keeps
 * their details and cover; their reading is tracked exactly like a Calibre book's. Books the source sync added from a
 * reading app are kept the same way. Calibre books are edited in Calibre, so everything here refuses them.
 */

/** A book's details as the add and edit forms send them. */
export interface ManualBookInput {
  title?: unknown;
  authors?: unknown;
  totalPages?: unknown;
  isbn?: unknown;
  publisher?: unknown;
  pubDate?: unknown;
  series?: unknown;
  seriesIndex?: unknown;
  description?: unknown;
  tags?: unknown;
}

/** Details that can't be saved as given: the message says what to change. Shown to the person as is. */
export class ManualBookError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const COVER_FETCH_TIMEOUT_MS = 10_000;

function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ManualBookError(`${field} must be text.`);
  const t = value.trim();
  if (t.length > max) throw new ManualBookError(`Keep the ${field.toLowerCase()} under ${max} characters.`);
  return t || null;
}

function list(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  const items = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(items) || items.some((i) => typeof i !== "string")) {
    throw new ManualBookError(`${field} must be a list of names.`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items as string[]) {
    const t = raw.trim();
    if (!t) continue;
    if (t.length > 200) throw new ManualBookError(`Keep each of the ${field.toLowerCase()} under 200 characters.`);
    if (!seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

function number(value: unknown, field: string, opts: { integer?: boolean; min: number; max: number }): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || (opts.integer && !Number.isInteger(n)) || n < opts.min || n > opts.max) {
    throw new ManualBookError(`${field} must be a ${opts.integer ? "whole " : ""}number from ${opts.min} to ${opts.max}.`);
  }
  return n;
}

function date(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) {
    throw new ManualBookError("The publication date must look like 2024, 2024-05 or 2024-05-17.");
  }
  const [y, m = "01", d = "01"] = value.split("-");
  const parsed = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (isNaN(parsed.getTime())) throw new ManualBookError("The publication date isn't a real date.");
  return parsed;
}

function isbn(value: unknown): string | null {
  const t = text(value, "ISBN", 40);
  if (!t) return null;
  const digits = t.replace(/[\s-]/g, "").toUpperCase();
  if (!/^(\d{9}[\dX]|\d{13})$/.test(digits)) throw new ManualBookError("The ISBN must have 10 or 13 digits.");
  return digits;
}

/** The fields of a book that the form sets. `partial` leaves out what the input doesn't mention. */
function parse(input: ManualBookInput, partial: boolean) {
  const has = (k: keyof ManualBookInput) => !partial || k in input;
  const out: Partial<Book> = {};
  if (has("title")) {
    const title = text(input.title, "Title", 500);
    if (!title) throw new ManualBookError("Give the book a title.");
    out.title = title;
  }
  if (has("authors")) {
    out.authors = list(input.authors, "Authors");
    out.authorSort = generateAuthorSort(out.authors);
  }
  if (has("totalPages")) out.totalPages = number(input.totalPages, "Pages", { integer: true, min: 1, max: 100_000 });
  if (has("isbn")) out.isbn = isbn(input.isbn);
  if (has("publisher")) out.publisher = text(input.publisher, "Publisher", 200);
  if (has("pubDate")) out.pubDate = date(input.pubDate);
  if (has("series")) out.series = text(input.series, "Series", 200);
  if (has("seriesIndex")) out.seriesIndex = number(input.seriesIndex, "The number in the series", { min: 0, max: 10_000 });
  if (has("description")) out.description = text(input.description, "Description", 20_000);
  if (has("tags")) out.tags = list(input.tags, "Tags");
  return out;
}

async function manualBook(id: number): Promise<Book> {
  const book = await bookRepository.findById(id);
  if (!book) throw new ManualBookError("That book isn't in Tome any more.", 404);
  if (book.source === "calibre") {
    throw new ManualBookError("This book comes from Calibre. Change its details in Calibre; Tome picks them up on the next sync.", 409);
  }
  return book;
}

export class ManualBookService {
  /** Adds a book by hand, ready to read: it starts as "to read", like a book new from Calibre. */
  async create(input: ManualBookInput): Promise<Book> {
    const fields = parse(input, false);
    const now = new Date();
    const book = await bookRepository.create({
      ...fields,
      title: fields.title!,
      calibreId: null,
      source: "manual",
      path: "",
      addedToLibrary: now,
      lastSynced: now,
    });
    try {
      await sessionRepository.create({ bookId: book.id, status: "to-read", sessionNumber: 1, isActive: true });
    } catch (error) {
      await bookRepository.delete(book.id);
      throw error;
    }
    getLogger().info({ bookId: book.id }, "Added a book by hand");
    return book;
  }

  /** Changes the details of a book added by hand. Only the fields sent change. */
  async update(id: number, input: ManualBookInput): Promise<Book> {
    await manualBook(id);
    const fields = parse(input, true);
    const updated = await bookRepository.update(id, { ...fields, updatedAt: new Date() });
    if (!updated) throw new ManualBookError("That book isn't in Tome any more.", 404);
    return updated;
  }

  /** Removes a book added by hand, with its reading sessions, progress and cover. The person confirms first. */
  async remove(id: number): Promise<void> {
    const book = await manualBook(id);
    await bookRepository.delete(id);
    deleteCover(book.coverFile);
    coverCache.delete(id);
    getLogger().info({ bookId: id }, "Removed a book added by hand");
  }

  /** Sets a book's cover from an image's bytes. */
  async setCover(id: number, bytes: Buffer): Promise<Book> {
    const book = await manualBook(id);
    let file: string;
    try {
      file = saveCover(id, bytes);
    } catch (error) {
      if (error instanceof CoverError) throw new ManualBookError(error.message);
      throw error;
    }
    // lastSynced is what cover URLs carry to bust caches; for a book added by hand it moves when the cover does.
    const updated = await bookRepository.update(id, { coverFile: file, lastSynced: new Date(), updatedAt: new Date() });
    deleteCover(book.coverFile);
    coverCache.delete(id);
    return updated!;
  }

  /** Downloads an image and sets it as a book's cover. Only called when the person saves a cover URL. */
  async setCoverFromUrl(id: number, url: unknown): Promise<Book> {
    await manualBook(id);
    return this.setCover(id, await downloadImage(url));
  }

  /** Takes a book's cover away; the placeholder shows instead. */
  async removeCover(id: number): Promise<Book> {
    const book = await manualBook(id);
    const updated = await bookRepository.update(id, { coverFile: null, lastSynced: new Date(), updatedAt: new Date() });
    deleteCover(book.coverFile);
    coverCache.delete(id);
    return updated!;
  }
}

/** Fetches an image from a web address, at most MAX_COVER_BYTES, giving up after COVER_FETCH_TIMEOUT_MS. */
export async function downloadImage(url: unknown): Promise<Buffer> {
  if (typeof url !== "string" || !url.trim()) throw new ManualBookError("Paste the address of the cover image.");
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ManualBookError("That cover address isn't a web address. It should start with https://.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ManualBookError("That cover address isn't a web address. It should start with https://.");
  }
  let res: Response;
  try {
    res = await fetch(parsed, { signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS), headers: { accept: "image/*" } });
  } catch {
    throw new ManualBookError(`Couldn't reach ${parsed.host} for the cover. Check the address, or upload the image instead.`, 502);
  }
  if (!res.ok) {
    throw new ManualBookError(`${parsed.host} answered ${res.status} for the cover. Check the address, or upload the image instead.`, 502);
  }
  if (Number(res.headers.get("content-length") ?? 0) > MAX_COVER_BYTES) {
    throw new ManualBookError("The cover is over 5 MB. Choose a smaller image.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_COVER_BYTES) {
        await reader.cancel();
        throw new ManualBookError("The cover is over 5 MB. Choose a smaller image.");
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

export const manualBookService = new ManualBookService();
