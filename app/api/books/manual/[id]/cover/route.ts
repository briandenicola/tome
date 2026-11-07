import { NextRequest, NextResponse } from "next/server";
import { manualBookService } from "@/lib/services/manual-book.service";
import { bookIdOf, jsonBody, manualBookError } from "../../errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Sets the cover of a book added by hand: an image file as multipart form data (field "file"), or JSON
 * `{ "url": "https://…" }` to download one.
 */
export async function PUT(request: NextRequest, props: Params) {
  const id = bookIdOf((await props.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid book ID format" }, { status: 400 });
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.startsWith("multipart/form-data")) {
      const file = (await request.formData()).get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "Choose an image file for the cover." }, { status: 400 });
      }
      return NextResponse.json(await manualBookService.setCover(id, Buffer.from(await file.arrayBuffer())));
    }
    const body = await jsonBody(request);
    if (!body) {
      return NextResponse.json({ error: "Send an image file, or JSON with the cover's url." }, { status: 400 });
    }
    return NextResponse.json(await manualBookService.setCoverFromUrl(id, body.url));
  } catch (error) {
    return manualBookError(error, "save the cover");
  }
}

/** Takes the cover away; the placeholder shows instead. */
export async function DELETE(_request: NextRequest, props: Params) {
  const id = bookIdOf((await props.params).id);
  if (id === null) return NextResponse.json({ error: "Invalid book ID format" }, { status: 400 });
  try {
    return NextResponse.json(await manualBookService.removeCover(id));
  } catch (error) {
    return manualBookError(error, "remove the cover");
  }
}
