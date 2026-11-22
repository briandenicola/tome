import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { buildYearReview } from "@/lib/services/year-review.service";

export const dynamic = "force-dynamic";

/** GET /api/stats/review?year=2026: the year's reading as highlights, for the Year in Review page. */
export async function GET(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear());
  const year = /^\d{4}$/.test(yearParam) ? parseInt(yearParam, 10) : NaN;
  if (Number.isNaN(year) || year < 1900 || year > 2100) {
    return NextResponse.json({ error: "year must be a year between 1900 and 2100" }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildYearReview(year));
  } catch (error) {
    getLogger().error({ err: error, year }, "Failed to build the year in review");
    return NextResponse.json({ error: "Failed to build the year in review" }, { status: 500 });
  }
}
