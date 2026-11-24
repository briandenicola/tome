import { and, asc, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { BaseRepository } from "./base.repository";
import { sourceLinks, sourceSyncs, SourceLink, NewSourceLink, SourceSync, type ReadingSourceId } from "@/lib/db/schema/source-links";

/** Links between reading-app items and Tome books, and each app's sync state. */
export class SourceLinkRepository extends BaseRepository<SourceLink, NewSourceLink, typeof sourceLinks> {
  constructor() {
    super(sourceLinks);
  }

  async findBySource(source: ReadingSourceId): Promise<SourceLink[]> {
    return this.getDatabase().select().from(sourceLinks).where(eq(sourceLinks.source, source)).orderBy(asc(sourceLinks.id)).all();
  }

  async findItem(source: ReadingSourceId, externalId: string): Promise<SourceLink | undefined> {
    return this.getDatabase()
      .select()
      .from(sourceLinks)
      .where(and(eq(sourceLinks.source, source), eq(sourceLinks.externalId, externalId)))
      .get();
  }

  /** The app items that count toward a Tome book. */
  async findByBookId(bookId: number): Promise<SourceLink[]> {
    return this.getDatabase().select().from(sourceLinks).where(eq(sourceLinks.bookId, bookId)).orderBy(asc(sourceLinks.id)).all();
  }

  /** Forgets that items no longer on the app's shelf were waiting there to be matched. */
  async clearShelvedExcept(source: ReadingSourceId, onShelf: string[]): Promise<void> {
    this.getDatabase()
      .update(sourceLinks)
      .set({ shelvedAt: null })
      .where(
        and(
          eq(sourceLinks.source, source),
          isNotNull(sourceLinks.shelvedAt),
          isNull(sourceLinks.queuedAt),
          ...(onShelf.length ? [notInArray(sourceLinks.externalId, onShelf)] : [])
        )
      )
      .run();
  }

  async getSync(source: ReadingSourceId): Promise<SourceSync | undefined> {
    return this.getDatabase().select().from(sourceSyncs).where(eq(sourceSyncs.source, source)).get();
  }

  async saveSync(source: ReadingSourceId, values: Partial<Omit<SourceSync, "source">>): Promise<void> {
    this.getDatabase()
      .insert(sourceSyncs)
      .values({ source, ...values })
      .onConflictDoUpdate({ target: sourceSyncs.source, set: values })
      .run();
  }

  /** Forgets every link and sync state of an app, for tests. */
  async clearSource(source: ReadingSourceId): Promise<void> {
    this.getDatabase().delete(sourceLinks).where(eq(sourceLinks.source, source)).run();
    this.getDatabase().delete(sourceSyncs).where(eq(sourceSyncs.source, source)).run();
  }
}

export const sourceLinkRepository = new SourceLinkRepository();
