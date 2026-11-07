import { NextRequest, NextResponse } from "next/server";
import { sourceSyncService } from "@/lib/services/source-sync.service";
import { SourceError } from "@/lib/sources/types";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Points a reading-app item at another Tome book (`{ "bookId": 12 }`) or adds it as a new one (`{ "addAsNew": true }`). */
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const raw = (await props.params).id;
  if (!/^\d+$/.test(raw)) return NextResponse.json({ error: "Invalid link ID format" }, { status: 400 });
  const body = await request.json().catch(() => null);
  const target =
    body?.addAsNew === true ? ("new" as const) : Number.isInteger(body?.bookId) ? { bookId: body.bookId as number } : null;
  if (!target) return NextResponse.json({ error: 'Send { "bookId": <Tome book id> } or { "addAsNew": true }.' }, { status: 400 });
  try {
    return NextResponse.json(await sourceSyncService.relink(Number(raw), target));
  } catch (error) {
    if (error instanceof SourceError) return NextResponse.json({ error: error.message }, { status: 404 });
    getLogger().error({ err: error }, "Relinking failed");
    return NextResponse.json({ error: "Couldn't change the link. The log says why." }, { status: 500 });
  }
}
