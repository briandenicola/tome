import { NextResponse } from "next/server";
import { bookRepository, sourceLinkRepository } from "@/lib/repositories";
import { SOURCES } from "@/lib/services/source-sync.service";
import { syncIntervalMinutes } from "@/lib/sources/scheduler";

export const dynamic = "force-dynamic";

/** Each reading app: whether it's set up, how its last sync went, and which Tome book each of its items counts toward. */
export async function GET() {
  const sources = [];
  for (const source of Object.values(SOURCES)) {
    const links = await sourceLinkRepository.findBySource(source.id);
    const bookIds = [...new Set(links.map((l) => l.bookId).filter((id): id is number => id !== null))];
    const books = new Map((await bookRepository.findByIds(bookIds)).map((b) => [b.id, b]));
    sources.push({
      id: source.id,
      name: source.name,
      configured: source.configured(),
      sync: (await sourceLinkRepository.getSync(source.id)) ?? null,
      links: links.map((l) => ({
        id: l.id,
        externalId: l.externalId,
        title: l.title,
        bookId: l.bookId,
        bookTitle: l.bookId !== null ? (books.get(l.bookId)?.title ?? null) : null,
        needsPages: l.bookId !== null && !books.get(l.bookId)?.totalPages,
        matchedBy: l.matchedBy,
        lastProgress: l.lastProgress,
        lastFinished: l.lastFinished,
        lastSeenAt: l.lastSeenAt,
      })),
    });
  }
  return NextResponse.json({ intervalMinutes: syncIntervalMinutes(), sources });
}
