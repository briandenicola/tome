import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import {
  buildReadingReport,
  reportToCsv,
  reportToMarkdown,
  REPORT_FORMATS,
  type ReportFormat,
} from "@/lib/services/reading-report.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/read?year=2026&format=json|md|csv
 * The books finished in a year with tags, start and finish dates, days taken and rating. Markdown and CSV come back
 * as a file download; JSON (the default) is for showing the report in Tome.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const yearParam = params.get("year") ?? String(new Date().getFullYear());
  const year = /^\d{4}$/.test(yearParam) ? parseInt(yearParam, 10) : NaN;
  if (Number.isNaN(year) || year < 1900 || year > 2100) {
    return NextResponse.json({ error: "year must be a year between 1900 and 2100" }, { status: 400 });
  }
  const format = (params.get("format") ?? "json") as ReportFormat;
  if (!REPORT_FORMATS.includes(format)) {
    return NextResponse.json({ error: 'format is "json", "md" or "csv"' }, { status: 400 });
  }

  try {
    const report = await buildReadingReport(year);
    if (format === "json") return NextResponse.json(report);
    const [body, type, ext] =
      format === "csv"
        ? [reportToCsv(report), "text/csv; charset=utf-8", "csv"]
        : [reportToMarkdown(report), "text/markdown; charset=utf-8", "md"];
    return new NextResponse(body, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="books-read-${year}.${ext}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    getLogger().error({ err: error, year }, "Failed to build the reading report");
    return NextResponse.json({ error: "Failed to build the report" }, { status: 500 });
  }
}
