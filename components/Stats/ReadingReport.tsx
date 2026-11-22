"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, FileText, Star } from "lucide-react";
import { cn } from "@/utils/cn";

interface ReportRow {
  bookId: number;
  title: string;
  authors: string[];
  tags: string[];
  startedDate: string | null;
  finishedDate: string;
  days: number | null;
  rating: number | null;
  reread: boolean;
}

interface Report {
  year: number;
  books: ReportRow[];
  summary: { count: number; pages: number; rated: number; averageRating: number | null; averageDays: number | null };
}

const YEARS_BACK = 15;

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const linkStyle =
  "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--foreground)] hover:bg-[var(--hover-bg)] shadow-sm";

/** The books finished in a year, with tags, dates and ratings, and links to download it as Markdown or CSV. */
export function ReadingReport() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/reports/read?year=${year}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: Report) => !cancelled && setReport(data))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year]);

  const s = report?.summary;

  return (
    <section aria-labelledby="reading-report-heading">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 id="reading-report-heading" className="text-2xl font-serif font-bold text-[var(--heading-text)] flex items-center gap-2">
          <FileText className="w-6 h-6 text-[var(--accent)]" />
          Reading Report
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="report-year">
            Year
          </label>
          <select
            id="report-year"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10))}
            className="px-3 py-1.5 text-sm rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--foreground)]"
          >
            {Array.from({ length: YEARS_BACK }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <a href={`/api/reports/read?year=${year}&format=md`} download className={linkStyle}>
            <Download className="w-4 h-4" />
            Markdown
          </a>
          <a href={`/api/reports/read?year=${year}&format=csv`} download className={linkStyle}>
            <Download className="w-4 h-4" />
            CSV
          </a>
        </div>
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md">
        {loading ? (
          <div className="p-6 space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-5 bg-foreground/10 rounded animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">Couldn&apos;t load the report.</p>
        ) : !report || report.books.length === 0 ? (
          <p className="p-6 text-sm text-foreground/70">No books finished in {year}.</p>
        ) : (
          <>
            <p className="px-4 pt-4 text-sm text-[var(--subheading-text)] font-medium">
              {s!.count} {s!.count === 1 ? "book" : "books"} · {s!.pages.toLocaleString()} pages
              {s!.averageRating !== null && ` · average rating ${s!.averageRating}`}
              {s!.averageDays !== null && ` · ${s!.averageDays} days per book`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-foreground/60 border-b border-[var(--border-color)]">
                    <th className="px-4 py-3 font-semibold">Book</th>
                    <th className="px-4 py-3 font-semibold">Tags</th>
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Read</th>
                    <th className="px-4 py-3 font-semibold">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {report.books.map((r, i) => (
                    <tr key={`${r.bookId}-${r.finishedDate}-${i}`} className="border-b border-[var(--border-color)] last:border-0 align-top">
                      <td className="px-4 py-3 min-w-[12rem]">
                        <Link href={`/books/${r.bookId}`} className="font-semibold text-[var(--heading-text)] hover:underline">
                          {r.title}
                        </Link>
                        {r.reread && <span className="ml-2 text-xs text-[var(--accent)]">re-read</span>}
                        <div className="text-[var(--subheading-text)]">{r.authors.join(", ")}</div>
                      </td>
                      <td className="px-4 py-3 min-w-[8rem]">
                        {r.tags.length ? (
                          <div className="flex flex-wrap gap-1">
                            {r.tags.map((t) => (
                              <span key={t} className="px-2 py-0.5 rounded bg-light-accent/30 text-xs">
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.startedDate ? `${shortDate(r.startedDate)} – ` : ""}
                        {shortDate(r.finishedDate)}
                        {r.days !== null && (
                          <div className="text-xs text-foreground/60">
                            {r.days} {r.days === 1 ? "day" : "days"}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.rating ? (
                          <span className="inline-flex" aria-label={`${r.rating} of 5 stars`}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                className={cn("w-4 h-4", n <= r.rating! ? "fill-[var(--accent)] text-[var(--accent)]" : "text-foreground/25")}
                              />
                            ))}
                          </span>
                        ) : (
                          <span className="text-foreground/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
