import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { bookRepository } from "@/lib/repositories";
import { parseBookFilters } from "@/lib/api/book-filters";

export const dynamic = "force-dynamic";

/** The most ids one request returns: far more than a library page holds, few enough to stay quick. */
const MAX_BOOK_IDS = 10000;

/**
 * GET /api/books/ids
 * The ids of every book matching the library's filters (same query string as GET /api/books), for "select all" in
 * bulk actions: the library loads books a page at a time, so the books on screen aren't all the books that match.
 */
export async function GET(request: NextRequest) {
  try {
    const { filters, sortBy } = parseBookFilters(request.nextUrl.searchParams);
    const { books, total } = await bookRepository.findWithFiltersAndRelations(filters, MAX_BOOK_IDS, 0, sortBy);
    return NextResponse.json({ ids: books.map((b: { id: number }) => b.id), total });
  } catch (error) {
    getLogger().error({ err: error }, "Error fetching book ids");
    return NextResponse.json({ error: "Failed to fetch book ids" }, { status: 500 });
  }
}
