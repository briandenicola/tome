import { NextRequest, NextResponse } from "next/server";
import { manualBookService } from "@/lib/services/manual-book.service";
import { jsonBody, manualBookError } from "./errors";

export const dynamic = "force-dynamic";

/** Adds a book by hand: title (required), authors, totalPages, isbn, publisher, pubDate, series, seriesIndex, description, tags. */
export async function POST(request: NextRequest) {
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Send the book's details as JSON." }, { status: 400 });
  try {
    return NextResponse.json(await manualBookService.create(body), { status: 201 });
  } catch (error) {
    return manualBookError(error, "add the book");
  }
}
