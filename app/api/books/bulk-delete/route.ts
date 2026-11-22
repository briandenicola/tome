import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { manualBookService } from "@/lib/services/manual-book.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/books/bulk-delete
 * Body: { bookIds: number[] }
 * Removes the books, with their sessions, progress, shelf places and covers. Calibre books are skipped, not removed:
 * the answer lists them so the person can be told.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The body must be JSON." }, { status: 400 });
  }
  const bookIds = (body as { bookIds?: unknown })?.bookIds;
  if (!Array.isArray(bookIds) || bookIds.length === 0 || !bookIds.every((id) => Number.isInteger(id) && id > 0)) {
    return NextResponse.json({ error: "bookIds must be a non-empty array of book ids" }, { status: 400 });
  }
  try {
    return NextResponse.json(await manualBookService.removeMany(bookIds as number[]));
  } catch (error) {
    getLogger().error({ err: error }, "Error removing books in bulk");
    return NextResponse.json({ error: "Failed to remove the books" }, { status: 500 });
  }
}
