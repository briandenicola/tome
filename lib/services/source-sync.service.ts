import { formatInTimeZone } from "date-fns-tz";
import { bookRepository, progressRepository, sessionRepository, sourceLinkRepository } from "@/lib/repositories";
import type { Book } from "@/lib/db/schema/books";
import type { ReadingSourceId, SourceLink } from "@/lib/db/schema/source-links";
import { progressService } from "@/lib/services/progress.service";
import { sessionService } from "@/lib/services/session.service";
import { manualBookService } from "@/lib/services/manual-book.service";
import { generateAuthorSort } from "@/lib/utils/author-sort";
import { getCurrentUserTimezone } from "@/utils/dateHelpers.server";
import { getLogger } from "@/lib/logger";
import { audiobookshelf } from "@/lib/sources/audiobookshelf";
import { grimmory } from "@/lib/sources/grimmory";
import { SourceError, type ReadingSource, type SourceItem } from "@/lib/sources/types";
import { estimatePagesFromDuration } from "@/lib/sources/page-estimate";
import { lookupIsbn } from "@/lib/services/isbn-lookup.service";

/**
 * Reading progress from the apps the books are read in (Audiobookshelf, Grimmory with its Kobo sync), logged in Tome
 * as if typed in, so streaks, stats and goals count it.
 *
 * Each app item is linked to one Tome book: by ISBN, else by title and an author's surname, else the book is added.
 * The first sync of an app only records where everything is; after that, a sync logs what changed since the last one.
 * Progress is a percentage. Several syncs on one day update that day's synced entry rather than adding more.
 */

export const SOURCES: Record<ReadingSourceId, ReadingSource> = { audiobookshelf, grimmory };

/** What one sync of one app did. */
export interface SourceSyncResult {
  source: ReadingSourceId;
  baseline: boolean;
  items: number;
  updated: number;
  added: number;
  finished: number;
  /** Books that can't be logged until they have a page count (Tome needs one to start or finish a book). */
  needPages: number;
  failed: number;
  /** Books put in the backlog from the app's to-read shelf (Grimmory's Kobo shelf), this sync. */
  queued: number;
  /** Books on that shelf Tome couldn't match to one of its own: listed on the Sync page to match, add or ignore. */
  unmatched: number;
  summary: string;
}

// --- Matching ---

/** An ISBN as 13 digits, or null. ISBN-10s are converted, so either form matches the other. */
export function normalizeIsbn(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(s)) return s;
  if (!/^\d{9}[\dX]$/.test(s)) return null;
  const core = `978${s.slice(0, 9)}`;
  const sum = [...core].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A title for matching: no subtitle, case, accents or punctuation, and no leading "the", "a" or "an". */
export function normalizeTitle(title: string): string {
  const main = title.split(/:| - | \(/)[0] ?? title;
  return fold(main).replace(/^(the|a|an) /, "");
}

/** An author's surname for matching: "Le Guin, Ursula" and "Ursula K. Le Guin" both give "guin". */
export function surname(author: string): string {
  const name = author.includes(",") ? author.split(",")[0]! : author;
  const words = fold(name).split(" ").filter((w) => w && !/^(jr|sr|ii|iii|iv|phd)$/.test(w));
  return words[words.length - 1] ?? "";
}

/** Tome books, indexed for matching. Orphaned books are left out. */
export class BookIndex {
  private byIsbn = new Map<string, Book>();
  private byTitle = new Map<string, Book[]>();

  constructor(books: Book[]) {
    // Most recently updated first, so a tie goes to the book read most lately.
    const sorted = books.filter((b) => !b.orphaned).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    for (const book of sorted) this.add(book);
  }

  add(book: Book): void {
    const isbn = normalizeIsbn(book.isbn);
    if (isbn && !this.byIsbn.has(isbn)) this.byIsbn.set(isbn, book);
    const key = normalizeTitle(book.title);
    this.byTitle.set(key, [...(this.byTitle.get(key) ?? []), book]);
  }

  /** The Tome book an item is, and how it was told; null when none fits. */
  match(item: SourceItem): { book: Book; by: "isbn" | "title" } | null {
    const isbn = normalizeIsbn(item.isbn);
    const byIsbn = isbn ? this.byIsbn.get(isbn) : undefined;
    if (byIsbn) return { book: byIsbn, by: "isbn" };
    const surnames = new Set(item.authors.map(surname).filter(Boolean));
    if (surnames.size === 0) return null;
    const found = (this.byTitle.get(normalizeTitle(item.title)) ?? []).find((b) => b.authors.some((a) => surnames.has(surname(a))));
    return found ? { book: found, by: "title" } : null;
  }
}

// --- Syncing ---

const running = new Set<ReadingSourceId>();

export class SourceSyncService {
  constructor(private readonly sources: Record<ReadingSourceId, ReadingSource> = SOURCES) {}

  /** The apps whose address and credentials are set. */
  configured(): ReadingSource[] {
    return Object.values(this.sources).filter((s) => s.configured());
  }

  /** Syncs every configured app; one app failing doesn't stop the others. */
  async syncAll(): Promise<Array<SourceSyncResult | { source: ReadingSourceId; error: string }>> {
    const results = [];
    for (const source of this.configured()) {
      try {
        results.push(await this.sync(source.id));
      } catch (error) {
        results.push({ source: source.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }

  /** Reads one app and brings Tome up to date with it. */
  async sync(id: ReadingSourceId): Promise<SourceSyncResult> {
    const source = this.sources[id];
    if (!source.configured()) throw new SourceError(`${source.name} isn't set up. Set its address and credentials in Tome's environment.`);
    if (running.has(id)) throw new SourceError(`${source.name} is already syncing. Try again in a minute.`);
    running.add(id);
    const log = getLogger();
    const startedAt = new Date();
    try {
      const state = await sourceLinkRepository.getSync(id);
      const baseline = !state?.baselinedAt;
      const items = await source.items();
      const index = new BookIndex(await bookRepository.findAll());
      const today = formatInTimeZone(new Date(), await getCurrentUserTimezone(), "yyyy-MM-dd");
      const result: SourceSyncResult = { source: id, baseline, items: items.length, updated: 0, added: 0, finished: 0, needPages: 0, failed: 0, queued: 0, unmatched: 0, summary: "" };

      for (const item of items) {
        try {
          await this.syncItem(source, item, index, baseline, today, result);
        } catch (error) {
          result.failed++;
          log.warn({ err: error, source: id, externalId: item.externalId }, "Couldn't sync an item");
        }
      }

      // After progress, so a book being read on the shelf is already marked as read in Tome and is left alone.
      const backlog = source.backlog;
      if (backlog) {
        const shelf = await backlog.items();
        // Books that left the shelf before being matched aren't waiting any more.
        await sourceLinkRepository.clearShelvedExcept(id, shelf.map((i) => i.externalId));
        for (const item of shelf) {
          try {
            await this.queueItem(source, backlog.status, item, index, result);
          } catch (error) {
            result.failed++;
            log.warn({ err: error, source: id, externalId: item.externalId }, `Couldn't queue a book from ${backlog.name}`);
          }
        }
      }

      result.summary = summarize(result, backlog?.name);
      await sourceLinkRepository.saveSync(id, {
        ...(baseline && { baselinedAt: startedAt }),
        lastRunAt: startedAt,
        lastSuccessAt: startedAt,
        lastError: result.failed ? `${result.failed} book(s) couldn't be synced; the log says why.` : null,
        lastSummary: result.summary,
      });
      log.info({ ...result }, `Synced ${source.name}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sourceLinkRepository.saveSync(id, { lastRunAt: startedAt, lastError: message });
      log.warn({ err: error, source: id }, `Couldn't sync ${source.name}`);
      throw error;
    } finally {
      running.delete(id);
    }
  }

  private async syncItem(
    source: ReadingSource,
    item: SourceItem,
    index: BookIndex,
    baseline: boolean,
    today: string,
    result: SourceSyncResult
  ): Promise<void> {
    const link = await sourceLinkRepository.findItem(source.id, item.externalId);
    const seen = { lastProgress: item.progress, lastFinished: item.finished, lastSeenAt: new Date() };

    if (baseline && !link) {
      // First sync: record where everything is. A book Tome has is linked; nothing is logged or added.
      const detailed = await this.detailed(source, item);
      const match = index.match(detailed);
      await sourceLinkRepository.create({
        source: source.id,
        externalId: item.externalId,
        title: detailed.title,
        bookId: match?.book.id ?? null,
        matchedBy: match?.by ?? null,
        ...seen,
      });
      return;
    }

    const before = link ?? { lastProgress: 0, lastFinished: false };
    if (link && item.progress === link.lastProgress && item.finished === link.lastFinished) return;

    // There's new reading: find the Tome book, or add it.
    let bookId = link?.bookId ?? null;
    let matchedBy: SourceLink["matchedBy"] = link?.matchedBy ?? null;
    let title = link?.title ?? item.title;
    let detailed: SourceItem | null = null;
    if (bookId === null) {
      detailed = await this.detailed(source, item);
      title = detailed.title;
      const match = index.match(detailed);
      if (match) {
        bookId = match.book.id;
        matchedBy = match.by;
      } else {
        const book = await this.addBook(source, detailed);
        index.add(book);
        bookId = book.id;
        matchedBy = "added";
        result.added++;
      }
    }

    await this.ensurePages(source, item, bookId, detailed);
    const outcome = await this.applyProgress(bookId, source, item, before, today);

    // A book waiting for its page count keeps the last progress it was logged at, so the next sync after the page
    // count is set logs this reading.
    const recorded = outcome === "needs-pages" ? { lastProgress: before.lastProgress, lastFinished: before.lastFinished, lastSeenAt: new Date() } : seen;
    if (link) await sourceLinkRepository.update(link.id, { bookId, matchedBy, title, ...recorded });
    else await sourceLinkRepository.create({ source: source.id, externalId: item.externalId, title, bookId, matchedBy, ...recorded });

    if (outcome === "needs-pages") result.needPages++;
    if (outcome === "finished") result.finished++;
    if (outcome === "finished" || outcome === "logged") result.updated++;
  }

  /**
   * Puts a book from the app's to-read shelf in Tome's backlog, when Tome has it (matched by ISBN, else title and
   * author). Tome doesn't add shelf books itself, where a near-miss would make a copy: one it can't match is listed
   * on the Sync page for the person to match, add or ignore, and tried again each sync meanwhile.
   * Each item is queued once, ever: taking it off the shelf doesn't take it out of Tome, and a book removed from Tome
   * isn't brought back while it's still on the shelf.
   */
  private async queueItem(
    source: ReadingSource,
    status: "to-read" | "read-next",
    item: SourceItem,
    index: BookIndex,
    result: SourceSyncResult
  ): Promise<void> {
    const link = await sourceLinkRepository.findItem(source.id, item.externalId);
    if (link?.queuedAt) return;

    let bookId = link?.bookId ?? null;
    let matchedBy: SourceLink["matchedBy"] = link?.matchedBy ?? null;
    if (bookId === null) {
      const match = index.match(await this.detailed(source, item));
      if (match) {
        bookId = match.book.id;
        matchedBy = match.by;
      }
    }

    const now = new Date();
    if (bookId === null) {
      result.unmatched++;
      if (link) await sourceLinkRepository.update(link.id, { shelvedAt: now });
      else
        await sourceLinkRepository.create({
          source: source.id,
          externalId: item.externalId,
          title: item.title,
          bookId: null,
          matchedBy: null,
          lastProgress: item.progress,
          lastFinished: item.finished,
          lastSeenAt: now,
          shelvedAt: now,
        });
      return;
    }

    if (await this.queueBook(bookId, status)) result.queued++;
    if (link) await sourceLinkRepository.update(link.id, { bookId, matchedBy, queuedAt: now, shelvedAt: null });
    else
      await sourceLinkRepository.create({
        source: source.id,
        externalId: item.externalId,
        title: item.title,
        bookId,
        matchedBy,
        lastProgress: item.progress,
        lastFinished: item.finished,
        lastSeenAt: now,
        queuedAt: now,
      });
  }

  /**
   * Puts a Tome book in the backlog unless it's being read, finished or dropped, or already there (pile or queue,
   * where it stays). A book with no reading session at all, or only a fresh to-read one from being added just now,
   * goes to `status`. Returns whether it was queued.
   */
  private async queueBook(bookId: number, status: "to-read" | "read-next", justAdded = false): Promise<boolean> {
    const active = await sessionRepository.findActiveByBookId(bookId);
    if (active) {
      if (!justAdded || active.status !== "to-read") return false;
      if (status === "read-next") await sessionService.updateStatus(bookId, { status });
      return true;
    }
    if (await sessionRepository.hasCompletedReads(bookId)) return false;
    if ((await sessionRepository.findLatestByBookId(bookId))?.status === "dnf") return false;
    await sessionService.updateStatus(bookId, { status });
    return true;
  }

  private async detailed(source: ReadingSource, item: SourceItem): Promise<SourceItem> {
    return item.title ? item : source.details(item);
  }

  /** Adds an app's book to Tome, with its cover, ready to read. */
  private async addBook(source: ReadingSource, item: SourceItem): Promise<Book> {
    const book = await manualBookService.create({
      title: item.title,
      authors: item.authors,
      totalPages: item.totalPages ?? null,
      isbn: normalizeIsbn(item.isbn),
      publisher: item.publisher ?? null,
      series: item.series ?? null,
      seriesIndex: item.seriesIndex ?? null,
      description: item.description ? item.description.slice(0, 20_000) : null,
    });
    const tagged = (await bookRepository.update(book.id, { source: source.id, authorSort: generateAuthorSort(book.authors) })) ?? book;
    try {
      const cover = await source.cover(item);
      if (cover) return await manualBookService.setCover(book.id, cover);
    } catch (error) {
      getLogger().info({ err: error, bookId: book.id }, "Added a book without its cover");
    }
    return tagged;
  }

  /**
   * Gives a book without a page count one, so its reading is logged and counts toward streaks and pages-read stats.
   * In order: the app's own page count; the print edition's, from Open Library by ISBN; or, for an audiobook, an
   * estimate from its length, marked as one. A book with a page count, or one nothing is known about, is left alone.
   */
  private async ensurePages(source: ReadingSource, item: SourceItem, bookId: number, detailed: SourceItem | null): Promise<void> {
    const book = await bookRepository.findById(bookId);
    if (!book || book.totalPages) return;
    let details = detailed;
    if (!details || (!details.totalPages && !details.durationSeconds)) {
      try {
        details = await source.details(item);
      } catch (error) {
        getLogger().info({ err: error, bookId }, "Couldn't get an item's details for its page count");
        return;
      }
    }
    if (details.totalPages) {
      await bookRepository.update(bookId, { totalPages: details.totalPages, pagesEstimated: false });
      return;
    }
    const isbn = normalizeIsbn(details.isbn) ?? book.isbn;
    if (isbn) {
      try {
        const found = await lookupIsbn(isbn);
        if (found.totalPages) {
          await bookRepository.update(bookId, { totalPages: found.totalPages, pagesEstimated: false });
          getLogger().info({ bookId, pages: found.totalPages }, "Took a book's page count from Open Library");
          return;
        }
      } catch {
        // Open Library doesn't know it, or can't be reached: estimate instead.
      }
    }
    const estimated = estimatePagesFromDuration(details.durationSeconds);
    if (estimated) {
      await bookRepository.update(bookId, { totalPages: estimated, pagesEstimated: true });
      getLogger().info({ bookId, pages: estimated, seconds: details.durationSeconds }, "Estimated a book's page count from its length");
    }
  }

  /**
   * Logs what changed since the app's last report. Returns what it did.
   * - Finished in the app: the book is marked read, on the day it was finished when the app says.
   * - Reading again after finishing: Tome starts a re-read.
   * - Otherwise: the progress is logged for today, or today's synced entry is moved on.
   * Tome is never moved backwards: if it's already further on (logged by hand or from another app), nothing is logged.
   */
  private async applyProgress(
    bookId: number,
    source: ReadingSource,
    item: SourceItem,
    before: { lastProgress: number; lastFinished: boolean },
    today: string
  ): Promise<"finished" | "logged" | "skipped" | "needs-pages"> {
    const note = `Synced from ${source.name}`;
    let active = await sessionRepository.findActiveByBookId(bookId);
    if (active?.status === "dnf") return "skipped";

    const readAgain = before.lastFinished && !item.finished;
    if (!active && (await sessionRepository.hasCompletedReads(bookId)) && !readAgain) {
      // Tome already has it as read, and this isn't a new read-through.
      return "skipped";
    }

    // Tome starts and finishes only books with a page count; an audiobook gets one once, by hand.
    if (!(await bookRepository.findById(bookId))?.totalPages) return "needs-pages";

    if (item.finished) {
      if (active?.status === "read") return "skipped";
      await this.noteFormat(await sessionService.ensureReadingStatus(bookId), source, item);
      const tz = await getCurrentUserTimezone();
      const finishedOn = item.finishedAt ? formatInTimeZone(item.finishedAt, tz, "yyyy-MM-dd") : today;
      try {
        await progressService.logProgress(bookId, { currentPercentage: 100, progressDate: finishedOn > today ? today : finishedOn, notes: note });
      } catch {
        // The finish date falls before progress Tome already has: finish today instead.
        await progressService.logProgress(bookId, { currentPercentage: 100, progressDate: today, notes: note });
      }
      return "finished";
    }

    if (active?.status !== "reading") {
      active = await sessionService.ensureReadingStatus(bookId);
    }
    await this.noteFormat(active, source, item);
    const latest = await progressRepository.findLatestBySessionId(active.id);
    if (latest && latest.currentPercentage >= item.progress) return "skipped";
    if (latest && latest.progressDate === today && latest.notes === note && item.progress < 100) {
      await progressService.updateProgress(latest.id, { currentPercentage: item.progress });
    } else {
      await progressService.logProgress(bookId, { currentPercentage: item.progress, progressDate: today, notes: note });
    }
    return item.progress >= 100 ? "finished" : "logged";
  }

  /** Records how a read is being done, from the app reporting it, unless the read already says. */
  private async noteFormat(session: { id: number; format?: string | null } | undefined, source: ReadingSource, item: SourceItem): Promise<void> {
    if (!session || session.format) return;
    const format = item.format ?? (source.id === "audiobookshelf" ? "audiobook" : "ebook");
    await sessionRepository.update(session.id, { format });
  }

  /** Points an app item at a different Tome book, or adds it as a new book. A person's choice; it sticks. */
  async relink(linkId: number, target: { bookId: number } | "new" | "ignore"): Promise<SourceLink> {
    const link = await sourceLinkRepository.findById(linkId);
    if (!link) throw new SourceError("That link isn't there any more. Refresh the page.");
    const source = this.sources[link.source];
    const waitingOnShelf = !!link.shelvedAt && !link.queuedAt;
    if (target === "ignore") {
      // Leave it out of Tome; the shelf import won't ask again.
      return (await sourceLinkRepository.update(link.id, { queuedAt: new Date(), shelvedAt: null }))!;
    }
    let bookId: number;
    let added = false;
    if (target === "new") {
      if (!source.configured()) throw new SourceError(`${source.name} isn't set up, so Tome can't read the book's details.`);
      const items = await source.items();
      const fromShelf = () => (source.backlog ? source.backlog.items() : Promise.resolve([] as SourceItem[]));
      const item = items.find((i) => i.externalId === link.externalId) ?? (await fromShelf()).find((i) => i.externalId === link.externalId) ?? {
        externalId: link.externalId,
        title: link.title,
        authors: [],
        progress: link.lastProgress,
        finished: link.lastFinished,
      };
      bookId = (await this.addBook(source, await this.detailed(source, item))).id;
      added = true;
    } else {
      if (!(await bookRepository.findById(target.bookId))) throw new SourceError("That Tome book isn't there any more.");
      bookId = target.bookId;
    }
    if (waitingOnShelf) {
      // Matched or added from the shelf list: it goes in the backlog, as a matched shelf book would have.
      await this.queueBook(bookId, source.backlog?.status ?? "to-read", added);
      return (await sourceLinkRepository.update(link.id, { bookId, matchedBy: "person", queuedAt: new Date(), shelvedAt: null }))!;
    }
    return (await sourceLinkRepository.update(link.id, { bookId, matchedBy: "person" }))!;
  }
}

function summarize(r: SourceSyncResult, backlogName?: string): string {
  const queued =
    (r.queued && backlogName ? `; ${r.queued} book(s) from ${backlogName} put in the backlog` : "") +
    (r.unmatched && backlogName ? `; ${r.unmatched} on ${backlogName} to match` : "");
  if (r.baseline) return `First sync: found ${r.items} book(s) with reading on them. From now on, new reading is logged${queued}.`;
  const parts = [`${r.updated} updated`];
  if (r.finished) parts.push(`${r.finished} finished`);
  if (r.added) parts.push(`${r.added} added to Tome`);
  if (r.needPages) parts.push(`${r.needPages} waiting for a page count`);
  if (r.queued && backlogName) parts.push(`${r.queued} from ${backlogName} put in the backlog`);
  if (r.unmatched && backlogName) parts.push(`${r.unmatched} on ${backlogName} to match`);
  if (r.failed) parts.push(`${r.failed} failed`);
  return parts.join(", ");
}

export const sourceSyncService = new SourceSyncService();
