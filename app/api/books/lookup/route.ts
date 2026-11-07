import { NextRequest, NextResponse } from "next/server";
import { lookupIsbn } from "@/lib/services/isbn-lookup.service";
import { manualBookError } from "../manual/errors";

export const dynamic = "force-dynamic";

/** GET /api/books/lookup?isbn=… — a book's details from Open Library, for the add-a-book form. */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await lookupIsbn(request.nextUrl.searchParams.get("isbn")));
  } catch (error) {
    return manualBookError(error, "look the ISBN up");
  }
}
