"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Headphones,
  Library,
  Star,
  Tablet,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { getCoverUrl } from "@/lib/utils/cover-url";

type Format = "ebook" | "audiobook" | "print";

interface ReportRow {
  bookId: number;
  title: string;
  authors: string[];
  series: string | null;
  seriesIndex: number | null;
  tags: string[];
  startedDate: string | null;
  finishedDate: string;
  days: number | null;
  rating: number | null;
  pages: number | null;
  reread: boolean;
  format: Format | null;
  lastSynced: string | null;
}

interface Report {
  year: number;
  books: ReportRow[];
  summary: {
    count: number;
    pages: number;
    rated: number;
    averageRating: number | null;
    averageDays: number | null;
    formats: Record<Format | "unknown", number>;
  };
}

type SortKey = "finished" | "title" | "days" | "rating";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const YEARS_BACK = 15;
const PAGE_SIZES = [10, 25, 50];

const FORMATS: Record<Format, { label: string; icon: typeof Tablet; pill: string; bar: string }> = {
  ebook: {
    label: "Ebook",
    icon: Tablet,
    pill: "bg-sky-700/10 text-sky-800 border-sky-700/25 dark:text-sky-300 dark:border-sky-300/25",
    bar: "bg-sky-700/70 dark:bg-sky-400/70",
  },
  audiobook: {
    label: "Audiobook",
    icon: Headphones,
    pill: "bg-amber-600/10 text-amber-800 border-amber-700/25 dark:text-amber-300 dark:border-amber-300/25",
    bar: "bg-amber-600/80 dark:bg-amber-400/70",
  },
  print: {
    label: "Print",
    icon: BookOpen,
    pill: "bg-emerald-700/10 text-emerald-800 border-emerald-700/25 dark:text-emerald-300 dark:border-emerald-300/25",
    bar: "bg-emerald-700/70 dark:bg-emerald-400/70",
  },
};

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const downloadStyle =
  "inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--foreground)] hover:bg-[var(--card-bg-emphasis)] shadow-sm transition-colors";

function compare(a: ReportRow, b: ReportRow, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title);
    case "days":
      // Reads without a start date sort last either way.
      return (a.days ?? Number.MAX_SAFE_INTEGER) - (b.days ?? Number.MAX_SAFE_INTEGER);
    case "rating":
      return (a.rating ?? 0) - (b.rating ?? 0);
    default:
      return a.finishedDate.localeCompare(b.finishedDate);
  }
}

/** The books finished in a year, with tags, dates, format and rating, and links to download it as Markdown or CSV. */
export function ReadingReport() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "finished", dir: "asc" });
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setPage(1);
    fetch(`/api/reports/read?year=${year}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: Report) => !cancelled && setReport(data))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year]);

  const sorted = useMemo(() => {
    const books = [...(report?.books ?? [])];
    books.sort((a, b) => {
      const c = compare(a, b, sort.key) || a.finishedDate.localeCompare(b.finishedDate);
      return sort.dir === "asc" ? c : -c;
    });
    return books;
  }, [report, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount);
  const first = (current - 1) * pageSize;
  const rows = sorted.slice(first, first + pageSize);
  const longest = Math.max(1, ...sorted.map((b) => b.days ?? 0));

  function sortBy(key: SortKey) {
    setPage(1);
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "title" ? "asc" : "desc" }));
  }

  const s = report?.summary;

  return (
    <section aria-labelledby="reading-report-heading" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
            className="px-3 py-1.5 text-sm font-semibold rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
          >
            {Array.from({ length: YEARS_BACK }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <a href={`/api/reports/read?year=${year}&format=md`} download className={downloadStyle}>
            <Download className="w-4 h-4" />
            Markdown
          </a>
          <a href={`/api/reports/read?year=${year}&format=csv`} download className={downloadStyle}>
            <Download className="w-4 h-4" />
            CSV
          </a>
        </div>
      </div>

      {loading ? (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-6 space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)] rounded animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-6 text-sm text-red-600">
          Couldn&apos;t load the report.
        </p>
      ) : !report || !s || report.books.length === 0 ? (
        <div className="bg-[var(--card-bg)] border border-dashed border-[var(--border-color)] rounded-lg p-10 text-center">
          <Library className="w-10 h-10 mx-auto text-[color:color-mix(in_srgb,var(--accent)_50%,transparent)]" />
          <p className="mt-3 font-serif text-lg text-[var(--heading-text)]">No books finished in {year}</p>
          <p className="text-sm text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)]">Books you mark as read show up here.</p>
        </div>
      ) : (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-sm overflow-hidden">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[var(--border-color)] border-b border-[var(--border-color)] bg-[color:color-mix(in_srgb,var(--card-bg-emphasis)_50%,transparent)]">
            <Tile label="Books" value={s.count.toLocaleString()} />
            <Tile label="Pages" value={s.pages.toLocaleString()} />
            <Tile
              label="Avg rating"
              value={s.averageRating !== null ? s.averageRating.toFixed(1) : "—"}
              hint={s.averageRating !== null ? `${s.rated} rated` : undefined}
              icon={<Star className="w-4 h-4 fill-[var(--accent)] text-[var(--accent)]" />}
            />
            <Tile
              label="Avg days"
              value={s.averageDays !== null ? String(Math.round(s.averageDays)) : "—"}
              hint="per book"
              icon={<Clock className="w-4 h-4 text-[var(--accent)]" />}
            />
          </div>
          <FormatSplit formats={s.formats} total={s.count} />

          {/* Table, from small tablets up */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)] bg-[color:color-mix(in_srgb,var(--card-bg-emphasis)_60%,transparent)] border-y border-[var(--border-color)]">
                  <th className="px-4 py-3 font-semibold w-10 text-right">#</th>
                  <SortHeader label="Book" k="title" sort={sort} onSort={sortBy} />
                  <th className="px-4 py-3 font-semibold">Format</th>
                  <th className="px-4 py-3 font-semibold">Tags</th>
                  <SortHeader label="Read" k="finished" sort={sort} onSort={sortBy} />
                  <SortHeader label="Days" k="days" sort={sort} onSort={sortBy} />
                  <SortHeader label="Rating" k="rating" sort={sort} onSort={sortBy} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`${r.bookId}-${r.finishedDate}-${first + i}`}
                    className={cn(
                      "align-middle border-b border-[color:color-mix(in_srgb,var(--border-color)_60%,transparent)] last:border-0 transition-colors hover:bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)]",
                      i % 2 === 1 ? "bg-[color:color-mix(in_srgb,var(--card-bg-emphasis)_75%,transparent)]" : "bg-transparent"
                    )}
                  >
                    <td className="px-4 py-3 text-right font-mono text-xs text-[color:color-mix(in_srgb,var(--foreground)_50%,transparent)]">{first + i + 1}</td>
                    <td className="px-4 py-3 min-w-[16rem]">
                      <div className="flex items-center gap-3">
                        <Cover row={r} />
                        <div className="min-w-0">
                          <Link href={`/books/${r.bookId}`} className="font-semibold text-[var(--heading-text)] hover:underline line-clamp-2">
                            {r.title}
                          </Link>
                          <div className="text-[var(--subheading-text)] font-serif line-clamp-1">{r.authors.join(", ")}</div>
                          {(r.series || r.reread) && (
                            <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs">
                              {r.series && (
                                <span className="text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)] italic">
                                  {r.series}
                                  {r.seriesIndex !== null && ` #${r.seriesIndex}`}
                                </span>
                              )}
                              {r.reread && <span className="font-semibold text-[var(--accent)]">Re-read</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <FormatPill format={r.format} />
                    </td>
                    <td className="px-4 py-3 min-w-[9rem]">
                      <Tags tags={r.tags} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-[var(--foreground)]">{shortDate(r.finishedDate)}</div>
                      {r.startedDate && <div className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_55%,transparent)]">from {shortDate(r.startedDate)}</div>}
                    </td>
                    <td className="px-4 py-3 w-36">
                      <DaysBar days={r.days} longest={longest} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Stars rating={r.rating} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards, on phones */}
          <ul className="sm:hidden divide-y divide-[color:color-mix(in_srgb,var(--border-color)_60%,transparent)]">
            {rows.map((r, i) => (
              <li
                key={`${r.bookId}-${r.finishedDate}-${first + i}`}
                className={cn("p-4 flex gap-3", i % 2 === 1 && "bg-[color:color-mix(in_srgb,var(--card-bg-emphasis)_75%,transparent)]")}
              >
                <Cover row={r} large />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div>
                    <Link href={`/books/${r.bookId}`} className="font-semibold text-[var(--heading-text)] hover:underline line-clamp-2">
                      {r.title}
                    </Link>
                    <div className="text-sm text-[var(--subheading-text)] font-serif line-clamp-1">{r.authors.join(", ")}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.format && <FormatPill format={r.format} />}
                    <Stars rating={r.rating} />
                    {r.reread && <span className="text-xs font-semibold text-[var(--accent)]">Re-read</span>}
                  </div>
                  <div className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_65%,transparent)]">
                    {r.startedDate ? `${shortDate(r.startedDate)} – ` : "Finished "}
                    {shortDate(r.finishedDate)}
                    {r.days !== null && ` · ${r.days} ${r.days === 1 ? "day" : "days"}`}
                  </div>
                  {r.tags.length > 0 && <Tags tags={r.tags} />}
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination */}
          <nav
            aria-label="Report pages"
            className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border-color)] bg-[color:color-mix(in_srgb,var(--card-bg-emphasis)_50%,transparent)] text-sm"
          >
            <div className="flex items-center gap-3 text-[color:color-mix(in_srgb,var(--foreground)_70%,transparent)]">
              <span aria-live="polite">
                {first + 1}–{first + rows.length} of {sorted.length}
              </span>
              <label className="flex items-center gap-1.5">
                <span className="sr-only sm:not-sr-only">Rows</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(parseInt(e.target.value, 10));
                    setPage(1);
                  }}
                  className="px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--foreground)]"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-1">
              <PageButton label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </PageButton>
              {pageNumbers(current, pageCount).map((n, i) =>
                n === null ? (
                  <span key={`gap-${i}`} className="px-1 text-[color:color-mix(in_srgb,var(--foreground)_40%,transparent)]">
                    …
                  </span>
                ) : (
                  <PageButton key={n} label={`Page ${n}`} current={n === current} onClick={() => setPage(n)}>
                    {n}
                  </PageButton>
                )
              )}
              <PageButton label="Next page" disabled={current === pageCount} onClick={() => setPage(current + 1)}>
                <ChevronRight className="w-4 h-4" />
              </PageButton>
            </div>
          </nav>
        </div>
      )}
    </section>
  );
}

/** Page numbers to show: the first, the last, and the ones around the current page, with gaps as null. */
export function pageNumbers(current: number, count: number): Array<number | null> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const shown = new Set([1, count, current - 1, current, current + 1].filter((n) => n >= 1 && n <= count));
  const out: Array<number | null> = [];
  let last = 0;
  for (const n of [...shown].sort((a, b) => a - b)) {
    if (n - last > 1) out.push(null);
    out.push(n);
    last = n;
  }
  return out;
}

function Tile({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[0.7rem] uppercase tracking-wider font-semibold text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)]">{label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-2xl font-serif font-bold text-[var(--heading-text)]">{value}</span>
        {icon}
      </div>
      {hint && <div className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_55%,transparent)]">{hint}</div>}
    </div>
  );
}

function FormatSplit({ formats, total }: { formats: Report["summary"]["formats"]; total: number }) {
  const known = (Object.keys(FORMATS) as Format[]).filter((f) => formats[f] > 0);
  if (known.length === 0 || total === 0) return null;
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)]" role="img" aria-label={known.map((f) => `${FORMATS[f].label} ${formats[f]}`).join(", ")}>
        {known.map((f) => (
          <div key={f} className={FORMATS[f].bar} style={{ width: `${(formats[f] / total) * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:color-mix(in_srgb,var(--foreground)_70%,transparent)]">
        {known.map((f) => (
          <span key={f} className="inline-flex items-center gap-1.5">
            <span className={cn("w-2.5 h-2.5 rounded-full", FORMATS[f].bar)} />
            {FORMATS[f].label} <span className="font-semibold text-[var(--foreground)]">{formats[f]}</span>
          </span>
        ))}
        {formats.unknown > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_20%,transparent)]" />
            Not set <span className="font-semibold text-[var(--foreground)]">{formats.unknown}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function SortHeader({ label, k, sort, onSort }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="px-4 py-3 font-semibold" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn("inline-flex items-center gap-1 uppercase tracking-wider hover:text-[var(--foreground)]", active && "text-[var(--accent)]")}
      >
        {label}
        <Icon className={cn("w-3.5 h-3.5", !active && "opacity-40")} />
      </button>
    </th>
  );
}

function Cover({ row, large = false }: { row: ReportRow; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        "relative flex-shrink-0 overflow-hidden rounded-sm shadow-md bg-[color:color-mix(in_srgb,var(--light-accent)_30%,transparent)] flex items-center justify-center",
        large ? "w-14 h-[5.25rem]" : "w-10 h-[3.75rem]"
      )}
    >
      {failed ? (
        <BookOpen className="w-5 h-5 text-[color:color-mix(in_srgb,var(--accent)_40%,transparent)]" />
      ) : (
        <Image src={getCoverUrl(row.bookId, row.lastSynced)} alt="" fill sizes="56px" className="object-cover" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

function FormatPill({ format }: { format: Format | null }) {
  if (!format) return <span className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_40%,transparent)]">—</span>;
  const { label, icon: Icon, pill } = FORMATS[format];
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold whitespace-nowrap", pill)}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_40%,transparent)]">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <Link
          key={t}
          href={`/library?tags=${encodeURIComponent(t)}`}
          className="px-2 py-0.5 rounded-full text-xs font-medium bg-[color:color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)] border border-[color:color-mix(in_srgb,var(--accent)_20%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--accent)_20%,transparent)]"
        >
          {t}
        </Link>
      ))}
    </div>
  );
}

function DaysBar({ days, longest }: { days: number | null; longest: number }) {
  if (days === null) return <span className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_40%,transparent)]">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)] overflow-hidden">
        <div className="h-full rounded-full bg-[color:color-mix(in_srgb,var(--accent)_70%,transparent)]" style={{ width: `${Math.max(4, (days / longest) * 100)}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-xs text-[color:color-mix(in_srgb,var(--foreground)_75%,transparent)]">{days}</span>
    </div>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_40%,transparent)]">Unrated</span>;
  return (
    <span className="inline-flex" role="img" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("w-4 h-4", n <= rating ? "fill-[var(--accent)] text-[var(--accent)]" : "text-[color:color-mix(in_srgb,var(--foreground)_20%,transparent)]")} />
      ))}
    </span>
  );
}

function PageButton({
  label,
  current = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  current?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-w-[2rem] h-8 px-2 inline-flex items-center justify-center rounded-md text-sm font-semibold transition-colors",
        current
          ? "bg-[var(--accent)] text-white shadow-sm"
          : "text-[var(--foreground)] hover:bg-[var(--card-bg)] border border-transparent hover:border-[var(--border-color)]",
        "disabled:opacity-35 disabled:pointer-events-none"
      )}
    >
      {children}
    </button>
  );
}
