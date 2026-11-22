import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { buildReadingInsights } from "@/lib/services/reading-insights.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/insights?year=2026
 * The year's reading day by day (for the calendar heatmap), the pace of finished books, and when the books being
 * read now should be finished.
 */
export async function GET(request: NextRequest) {
  const yearParam = request.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear());
  const year = /^\d{4}$/.test(yearParam) ? parseInt(yearParam, 10) : NaN;
  if (Number.isNaN(year) || year < 1900 || year > 2100) {
    return NextResponse.json({ error: "year must be a year between 1900 and 2100" }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildReadingInsights(year));
  } catch (error) {
    getLogger().error({ err: error, year }, "Failed to build reading insights");
    return NextResponse.json({ error: "Failed to build reading insights" }, { status: 500 });
  }
}
