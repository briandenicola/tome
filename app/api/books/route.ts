import { getLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { bookRepository } from "@/lib/repositories";
import { parseBookFilters } from "@/lib/api/book-filters";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "50");
    const skip = parseInt(searchParams.get("skip") || "0");
    const { filters, sortBy } = parseBookFilters(searchParams);

    // Get books with filters, sessions, and progress in a single optimized query
    // This replaces the N+1 query pattern (1 + N session queries + N progress queries)
    // with a single JOIN query for massive performance improvement
    const { books: booksWithStatus, total } = await bookRepository.findWithFiltersAndRelations(filters, limit, skip, sortBy);

    return NextResponse.json({
      books: booksWithStatus,
      total,
      limit,
      skip,
    });
  } catch (error) {
    getLogger().error({ err: error }, "Error fetching books");
    return NextResponse.json({ error: "Failed to fetch books" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { calibreId, totalPages } = body;

    if (!calibreId) {
      return NextResponse.json({ error: "calibreId is required" }, { status: 400 });
    }

    const book = await bookRepository.findByCalibreId(calibreId);

    if (!book) {
      return NextResponse.json({ error: "Book not found" }, { status: 404 });
    }

    if (totalPages !== undefined) {
      const updated = await bookRepository.update(book.id, { totalPages });
      return NextResponse.json(updated);
    }

    return NextResponse.json(book);
  } catch (error) {
    getLogger().error({ err: error }, "Error updating book");
    return NextResponse.json({ error: "Failed to update book" }, { status: 500 });
  }
}
