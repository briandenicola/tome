import { bookRepository, sessionRepository, progressRepository, sourceLinkRepository } from "@/lib/repositories";
import type { Book } from "@/lib/db/schema/books";
import type { ReadingSession } from "@/lib/db/schema/reading-sessions";
import { manualBookService, ManualBookError, type ManualBookInput } from "@/lib/services/manual-book.service";
import { sessionService } from "@/lib/services/session.service";
import { getLogger } from "@/lib/logger";
import { effectiveFormat } from "@/lib/utils/reading-format";

/**
 * The backlog: books waiting to be read, as "to read" (the pile) or "read next" (the ordered queue). What agents use,
 * through the MCP endpoint, to find books, add them and queue them. Everything here goes through the same services as
 * the app, so a book an agent adds is exactly like one added by hand.
 */

export const BACKLOG_STATUSES = ["to-read", "read-next"] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

/** A book as the backlog tools describe it: enough to tell books apart and act on one. */
export interface BacklogBook {
  id: number;
  title: string;
  authors: string[];
  /** "calibre" for books from the Calibre library, otherwise how the book got into Tome. */
  source: string;
  status: string | null;
  totalPages: number | null;
  /** True when totalPages is estimated from an audiobook's length. */
  pagesEstimated?: boolean;
  isbn?: string | null;
  series?: string | null;
  seriesIndex?: number | null;
  /** Place in the read-next queue, from 1. Only on read-next books. */
  position?: number;
  /** When the current read began (YYYY-MM-DD). Only on books being read, finished or dropped. */
  startedDate?: string | null;
  /** Where the current read is, as last logged in Tome. Null when nothing is logged yet. Only on books being read. */
  progress?: BookProgress | null;
  /** How the current or last read is being done: "ebook", "audiobook" or "print". Left out when unknown. */
  format?: string;
  /**
   * What reading apps (Audiobookshelf, Grimmory) last reported for this book. Tome logs app progress only once a book
   * has a page count, so an audiobook without one shows its listening progress here and nowhere else.
   */
  appProgress?: AppProgress[];
}

export interface BookProgress {
  /** 0 to 100. */
  percentage: number;
  /** Left out when the book has no page count, as audiobooks often don't. */
  currentPage?: number;
  /** The day it was logged, YYYY-MM-DD. */
  date: string;
}

export interface AppProgress {
  source: string;
  /** 0 to 100. */
  percentage: number;
  finished: boolean;
  /** When Tome last saw the item in the app, ISO 8601. */
  seenAt: string;
}

/** What adding a book did: either the book, or the books already in Tome that look like it. */
export type AddResult =
  | { added: true; book: BacklogBook; warnings: string[] }
  | { added: false; duplicates: BacklogBook[]; message: string };

/** A request that can't be done as asked: the message says why, and is shown to the agent as is. */
export class BacklogError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function asStatus(value: unknown, fallback: BacklogStatus): BacklogStatus {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" && (BACKLOG_STATUSES as readonly string[]).includes(value)) return value as BacklogStatus;
  throw new BacklogError('The status is "to-read" or "read-next".');
}

function view(book: Book, status: string | null): BacklogBook {
  return {
    id: book.id,
    title: book.title,
    authors: book.authors ?? [],
    source: book.source,
    status,
    totalPages: book.totalPages ?? null,
    ...(book.pagesEstimated ? { pagesEstimated: true } : {}),
    isbn: book.isbn ?? null,
    series: book.series ?? null,
    seriesIndex: book.seriesIndex ?? null,
  };
}

async function sessionOf(bookId: number): Promise<ReadingSession | undefined> {
  return (await sessionRepository.findActiveByBookId(bookId)) ?? (await sessionRepository.findLatestByBookId(bookId));
}

/** A book with its status and, for one being read, where the reading is: what an agent needs to answer "how far am I?". */
async function describe(book: Book, session?: ReadingSession | null): Promise<BacklogBook> {
  const s = session === undefined ? await sessionOf(book.id) : session ?? undefined;
  const out = view(book, s?.status ?? null);
  if (!s) return out;
  if (s.status === "reading" || s.status === "read" || s.status === "dnf") {
    out.startedDate = s.startedDate ?? null;
    const format = effectiveFormat(s.format, book.source);
    if (format) out.format = format;
  }
  if (s.status === "reading") {
    const latest = await progressRepository.findLatestBySessionId(s.id);
    out.progress = latest
      ? {
          percentage: latest.currentPercentage,
          ...(book.totalPages ? { currentPage: latest.currentPage } : {}),
          date: latest.progressDate,
        }
      : null;
  }
  const links = await sourceLinkRepository.findByBookId(book.id);
  if (links.length > 0) {
    out.appProgress = links.map((l) => ({
      source: l.source,
      percentage: l.lastProgress,
      finished: l.lastFinished,
      seenAt: l.lastSeenAt.toISOString(),
    }));
  }
  return out;
}

export class BacklogService {
  /** Books in Tome (Calibre's included) whose title or author contains the query, or whose ISBN is the query. */
  async search(query: unknown, limit: unknown = 10): Promise<BacklogBook[]> {
    if (typeof query !== "string" || !query.trim()) throw new BacklogError("Say what to search for: a title, an author or an ISBN.");
    const q = query.trim();
    const n = typeof limit === "number" && Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 10;

    const found = new Map<number, Book>();
    if (/^[\d\s-]{9,17}[\dXx]?$/.test(q)) {
      for (const b of await bookRepository.findByIsbn(q)) found.set(b.id, b);
    }
    const { books } = await bookRepository.findWithFiltersAndRelations({ search: q }, n, 0, "title");
    const ids = books.map((b: { id: number }) => b.id).filter((id: number) => !found.has(id));
    for (const b of await bookRepository.findByIds(ids)) found.set(b.id, b);

    const out: BacklogBook[] = [];
    for (const b of [...found.values()].slice(0, n)) out.push(await describe(b));
    return out;
  }

  /** Books already in Tome that look like this one: the same ISBN, or the same title by one of the same authors. */
  async findDuplicates(input: { title?: unknown; authors?: unknown; isbn?: unknown }): Promise<Book[]> {
    const found = new Map<number, Book>();
    if (typeof input.isbn === "string" && input.isbn.trim()) {
      for (const b of await bookRepository.findByIsbn(input.isbn)) found.set(b.id, b);
    }
    if (typeof input.title === "string" && input.title.trim()) {
      const title = normalize(input.title);
      const authors = (Array.isArray(input.authors) ? input.authors : typeof input.authors === "string" ? input.authors.split(",") : [])
        .filter((a): a is string => typeof a === "string")
        .map(normalize)
        .filter(Boolean);
      const { books } = await bookRepository.findWithFiltersAndRelations({ search: input.title.trim() }, 25, 0, "title");
      const candidates = await bookRepository.findByIds(books.map((b: { id: number }) => b.id));
      for (const b of candidates) {
        if (normalize(b.title) !== title) continue;
        const theirs = (b.authors ?? []).map(normalize);
        if (authors.length === 0 || theirs.length === 0 || authors.some((a) => theirs.includes(a))) found.set(b.id, b);
      }
    }
    return [...found.values()];
  }

  /**
   * Adds a book to the backlog. A book that looks like one already in Tome isn't added unless `allowDuplicate` is
   * true: the answer lists the matches instead, so the agent can queue one of those.
   */
  async add(
    input: ManualBookInput & { status?: unknown; coverUrl?: unknown; allowDuplicate?: unknown }
  ): Promise<AddResult> {
    const status = asStatus(input.status, "to-read");
    if (input.allowDuplicate !== true) {
      const duplicates = await this.findDuplicates(input);
      if (duplicates.length > 0) {
        const views: BacklogBook[] = [];
        for (const b of duplicates) views.push(await describe(b));
        return {
          added: false,
          duplicates: views,
          message:
            "Tome already has a book like this, so nothing was added. Queue one of these with queue_book, or add it again with allowDuplicate: true if it really is a different book.",
        };
      }
    }

    const { status: _s, coverUrl, allowDuplicate: _d, ...details } = input;
    const book = await manualBookService.create(details);
    const warnings: string[] = [];
    if (status === "read-next") await sessionService.updateStatus(book.id, { status: "read-next" });
    let saved = book;
    if (typeof coverUrl === "string" && coverUrl.trim()) {
      try {
        saved = await manualBookService.setCoverFromUrl(book.id, coverUrl.trim());
      } catch (error) {
        warnings.push(`The book was added, but its cover wasn't: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    getLogger().info({ bookId: book.id, status }, "Added a book to the backlog through MCP");
    return { added: true, book: view(saved, status), warnings };
  }

  /**
   * Puts a book that's in Tome into the backlog, or moves it between "to read" and "read next". Books being read,
   * finished or dropped are left alone: moving those back loses where the reading was, so that stays in the app.
   */
  async queue(bookId: unknown, statusInput: unknown): Promise<BacklogBook> {
    if (typeof bookId !== "number" || !Number.isInteger(bookId)) throw new BacklogError("bookId must be a book's id, a whole number.");
    const status = asStatus(statusInput, "to-read");
    const book = await bookRepository.findById(bookId);
    if (!book) throw new BacklogError("There's no book with that id in Tome.", 404);

    const active = await sessionRepository.findActiveByBookId(bookId);
    const current = active?.status ?? (await sessionRepository.findLatestByBookId(bookId))?.status ?? null;
    if (current === "reading") {
      throw new BacklogError(`"${book.title}" is being read now. Moving it back to the backlog is done in Tome, so no reading is lost.`, 409);
    }
    if (!active && (current === "read" || current === "dnf")) {
      throw new BacklogError(
        `"${book.title}" was ${current === "read" ? "finished" : "dropped"}. To read it again, start a re-read in Tome.`,
        409
      );
    }
    if (current !== status) await sessionService.updateStatus(bookId, { status });
    return view(book, status);
  }

  /** The books being read now, most recently touched first, each with where the reading is. */
  async reading(limit: unknown = 50): Promise<BacklogBook[]> {
    const n = typeof limit === "number" && Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    const sessions = await sessionRepository.findByStatus("reading", true, n);
    const books = new Map((await bookRepository.findByIds(sessions.map((s) => s.bookId))).map((b) => [b.id, b]));
    const out: BacklogBook[] = [];
    for (const s of sessions) {
      const b = books.get(s.bookId);
      if (b) out.push(await describe(b, s));
    }
    return out;
  }

  /** The backlog: the read-next queue in order, then the to-read pile newest first. */
  async list(statusInput: unknown, limit: unknown = 50): Promise<BacklogBook[]> {
    const only = statusInput === undefined || statusInput === null || statusInput === "" ? null : asStatus(statusInput, "to-read");
    const n = typeof limit === "number" && Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    const out: BacklogBook[] = [];

    if (only !== "to-read") {
      const queued = await sessionRepository.findReadNextWithBooks();
      const books = new Map((await bookRepository.findByIds(queued.map((s) => s.bookId))).map((b) => [b.id, b]));
      queued.forEach((s, i) => {
        const b = books.get(s.bookId);
        if (b && !b.orphaned) out.push({ ...view(b, "read-next"), position: i + 1 });
      });
    }
    if (only !== "read-next" && out.length < n) {
      const { books } = await bookRepository.findWithFiltersAndRelations({ status: "to-read" }, n - out.length, 0, "created_desc");
      const full = new Map((await bookRepository.findByIds(books.map((b: { id: number }) => b.id))).map((b) => [b.id, b]));
      for (const row of books as Array<{ id: number }>) {
        const b = full.get(row.id);
        if (b) out.push(view(b, "to-read"));
      }
    }
    return out.slice(0, n);
  }
}

export { ManualBookError };
export const backlogService = new BacklogService();
