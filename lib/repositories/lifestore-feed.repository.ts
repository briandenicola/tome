import { and, asc, gt, inArray, or, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/context";
import { books, Book } from "@/lib/db/schema/books";
import { readingSessions, ReadingSession } from "@/lib/db/schema/reading-sessions";
import { progressLogs, ProgressLog } from "@/lib/db/schema/progress-logs";

/** Reads for the life store feed: books with reading on them, a page at a time, with their sessions and progress. */
export class LifestoreFeedRepository {
  /**
   * Books past "to read": a session started, finished or abandoned, or any progress logged. Ordered by id, after
   * `afterId`, at most `limit`. Books only on the to-read pile carry no reading, so they're left out.
   */
  async booksWithReading(afterId: number, limit: number): Promise<Book[]> {
    const db = getDatabase();
    const read = sql`exists (select 1 from ${readingSessions} s where s.book_id = ${books.id} and (s.status in ('reading', 'read', 'dnf') or s.started_date is not null))`;
    const logged = sql`exists (select 1 from ${progressLogs} p where p.book_id = ${books.id})`;
    return db.select().from(books).where(and(gt(books.id, afterId), or(read, logged))).orderBy(asc(books.id)).limit(limit).all();
  }

  async sessionsFor(bookIds: number[]): Promise<ReadingSession[]> {
    if (bookIds.length === 0) return [];
    return getDatabase()
      .select()
      .from(readingSessions)
      .where(inArray(readingSessions.bookId, bookIds))
      .orderBy(asc(readingSessions.sessionNumber), asc(readingSessions.id))
      .all();
  }

  async progressFor(bookIds: number[]): Promise<ProgressLog[]> {
    if (bookIds.length === 0) return [];
    return getDatabase()
      .select()
      .from(progressLogs)
      .where(inArray(progressLogs.bookId, bookIds))
      .orderBy(asc(progressLogs.progressDate), asc(progressLogs.id))
      .all();
  }
}

export const lifestoreFeedRepository = new LifestoreFeedRepository();
