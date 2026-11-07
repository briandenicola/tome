import { NextRequest, NextResponse } from "next/server";
import { SOURCES, sourceSyncService } from "@/lib/services/source-sync.service";
import { SourceError } from "@/lib/sources/types";
import { READING_SOURCES, type ReadingSourceId } from "@/lib/db/schema/source-links";
import { getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Syncs one reading app now. */
export async function POST(_request: NextRequest, props: { params: Promise<{ source: string }> }) {
  const { source } = await props.params;
  if (!(READING_SOURCES as readonly string[]).includes(source)) {
    return NextResponse.json({ error: `There's no reading app called "${source}".` }, { status: 404 });
  }
  try {
    return NextResponse.json(await sourceSyncService.sync(source as ReadingSourceId));
  } catch (error) {
    if (error instanceof SourceError) return NextResponse.json({ error: error.message }, { status: 502 });
    getLogger().error({ err: error, source }, "Progress sync failed");
    return NextResponse.json({ error: `Couldn't sync ${SOURCES[source as ReadingSourceId].name}. The log says why.` }, { status: 500 });
  }
}
