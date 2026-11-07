import { NextRequest, NextResponse } from "next/server";
import { FeedPageError, feedPage } from "@/lib/services/lifestore-feed.service";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/lifestore/records?page=&limit= — the life store feed: every book with reading on it, with its reads and
 * progress. For the life store's Tome integration; an API token with read access is enough.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    return NextResponse.json(await feedPage(params.get("page"), params.get("limit")));
  } catch (error) {
    if (error instanceof FeedPageError) return NextResponse.json({ error: error.message }, { status: 400 });
    getLogger().error({ err: error }, "Life store feed failed");
    return NextResponse.json({ error: "The feed couldn't be read. Tome's log says why." }, { status: 500 });
  }
}
