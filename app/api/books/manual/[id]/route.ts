import { NextRequest, NextResponse } from "next/server";
import { manualBookService } from "@/lib/services/manual-book.service";
import { bookIdOf, jsonBody, manualBookError } from "../errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Changes a book added by hand; only the fields sent change. Calibre books are refused (409). */
export async function PATCH(request: NextRequest, props: Params) {
  const id = bookIdOf((await props.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid book ID format" }, { status: 400 });
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Send the book's details as JSON." }, { status: 400 });
  try {
    return NextResponse.json(await manualBookService.update(id, body));
  } catch (error) {
    return manualBookError(error, "save the book");
  }
}

/** Removes a book added by hand, with its sessions, progress and cover. Calibre books are refused (409). */
export async function DELETE(_request: NextRequest, props: Params) {
  const id = bookIdOf((await props.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid book ID format" }, { status: 400 });
  try {
    await manualBookService.remove(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return manualBookError(error, "remove the book");
  }
}
