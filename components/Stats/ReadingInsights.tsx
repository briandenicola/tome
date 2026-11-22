"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Flame, Gauge, Hourglass, Rabbit, Snail, Sparkles, Turtle } from "lucide-react";
import { cn } from "@/utils/cn";

type Format = "ebook" | "audiobook" | "print";

interface HeatmapDay {
  date: string;
  pages: number;
  books: string[];
}

interface PaceBook {
  bookId: number;
  title: string;
  days: number;
  pages: number;
  pagesPerDay: number;
  format: Format | null;
}

interface CurrentPace {
  bookId: number;
  title: string;
  percentage: number;
  pagesLeft: number;
  pagesPerDay: number | null;
  estimatedFinish: string | null;
  format: Format | null;
}

interface Insights {
  year: number;
  heatmap: {
    days: HeatmapDay[];
    activeDays: number;
    totalPages: number;
    longestRun: number;
    bestDay: HeatmapDay | null;
    byWeekday: number[];
  };
  pace: {
    averagePagesPerDay: number | null;
    averageDays: number | null;
    fastest: PaceBook | null;
    slowest: PaceBook | null;
    byFormat: Array<{ format: Format; books: number; averageDays: number; averagePagesPerDay: number }>;
    current: CurrentPace[];
  };
}

const YEARS_BACK = 15;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FORMAT_LABEL: Record<Format, string> = { ebook: "Ebook", audiobook: "Audiobook", print: "Print" };
const FORMAT_BAR: Record<Format, string> = {
  ebook: "bg-sky-700/70 dark:bg-sky-400/70",
  audiobook: "bg-amber-600/80 dark:bg-amber-400/70",
  print: "bg-emerald-700/70 dark:bg-emerald-400/70",
};

/** Heat levels 0 (no reading) to 4, as accent at rising strength. */
const LEVEL_BG = [
  "bg-[color:color-mix(in_srgb,var(--foreground)_9%,transparent)]",
  "bg-[color:color-mix(in_srgb,var(--accent)_28%,transparent)]",
  "bg-[color:color-mix(in_srgb,var(--accent)_50%,transparent)]",
  "bg-[color:color-mix(in_srgb,var(--accent)_75%,transparent)]",
  "bg-[var(--accent)]",
];

const dayMs = 86_400_000;
const toDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Thresholds splitting the reading days into four even groups, so a heavy week doesn't wash out the rest. */
export function heatLevels(pages: number[]): (p: number) => number {
  const sorted = pages.filter((p) => p > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return () => 0;
  const q = (f: number) => sorted[Math.max(0, Math.ceil(f * sorted.length) - 1)]!;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  return (p) => (p <= 0 ? 0 : p <= cuts[0]! ? 1 : p <= cuts[1]! ? 2 : p <= cuts[2]! ? 3 : 4);
}

/** The year as weeks of seven days, Sunday first; days outside the year are null. */
export function yearWeeks(year: number): Array<Array<string | null>> {
  const first = Date.UTC(year, 0, 1);
  const last = Date.UTC(year, 11, 31);
  const start = first - new Date(first).getUTCDay() * dayMs;
  const weeks: Array<Array<string | null>> = [];
  for (let t = start; t <= last; t += 7 * dayMs) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const d = t + i * dayMs;
      return d < first || d > last ? null : fromDay(d);
    }));
  }
  return weeks;
}

export function ReadingInsights() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setPicked(null);
    fetch(`/api/stats/insights?year=${year}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((d: Insights) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year]);

  const byDate = useMemo(() => new Map((data?.heatmap.days ?? []).map((d) => [d.date, d])), [data]);
  const level = useMemo(() => heatLevels((data?.heatmap.days ?? []).map((d) => d.pages)), [data]);
  const weeks = useMemo(() => yearWeeks(year), [year]);
  // On a narrow screen the grid scrolls: start at today for this year, so recent reading shows first.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el && !loading && year === thisYear) el.scrollLeft = el.scrollWidth;
  }, [loading, year, thisYear]);
    const pickedDay = picked ? (byDate.get(picked) ?? { date: picked, pages: 0, books: [] }) : null;

  return (
    <section aria-labelledby="reading-insights-heading" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 id="reading-insights-heading" className="text-2xl font-serif font-bold text-[var(--heading-text)] flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-[var(--accent)]" />
          Reading Rhythm
        </h2>
        <select
          aria-label="Year"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value, 10))}
          className="self-start sm:self-auto px-3 py-1.5 text-sm font-semibold rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm"
        >
          {Array.from({ length: YEARS_BACK }, (_, i) => thisYear - i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-6 space-y-3" aria-busy="true">
          <div className="h-28 bg-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)] rounded animate-pulse" />
          <div className="h-20 bg-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)] rounded animate-pulse" />
        </div>
      ) : error || !data ? (
        <p className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-6 text-sm text-red-600">Couldn&apos;t load your reading rhythm.</p>
      ) : (
        <>
          {/* Heatmap */}
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[var(--border-color)] border-b border-[var(--border-color)]">
              <Tile icon={<CalendarDays className="w-4 h-4" />} label="Reading days" value={data.heatmap.activeDays.toLocaleString()} />
              <Tile icon={<Flame className="w-4 h-4" />} label="Longest run" value={`${data.heatmap.longestRun}`} hint={data.heatmap.longestRun === 1 ? "day" : "days"} />
              <Tile
                icon={<Sparkles className="w-4 h-4" />}
                label="Best day"
                value={data.heatmap.bestDay ? data.heatmap.bestDay.pages.toLocaleString() : "—"}
                hint={data.heatmap.bestDay ? `pages · ${shortDate(data.heatmap.bestDay.date)}` : undefined}
              />
              <Tile icon={<Gauge className="w-4 h-4" />} label="Pages" value={data.heatmap.totalPages.toLocaleString()} hint="logged this year" />
            </div>

            <div className="p-4 space-y-3">
              <div ref={scroller} className="overflow-x-auto pb-1 [--cell:0.8rem] lg:[--cell:0.95rem]">
                <div className="inline-flex gap-2 min-w-full">
                  <div className="grid grid-rows-[auto_repeat(7,var(--cell))] gap-[3px] text-[0.65rem] text-[color:color-mix(in_srgb,var(--foreground)_55%,transparent)] pr-1">
                    <span />
                    {WEEKDAYS.map((d, i) => (
                      <span key={d} className="leading-[var(--cell)]">
                        {i % 2 === 1 ? d : ""}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-[3px]" role="grid" aria-label={`Reading in ${year}, day by day`}>
                    {weeks.map((week, w) => {
                      const firstOfMonth = week.find((d) => d && d.endsWith("-01"));
                      return (
                        <div key={w} className="grid grid-rows-[auto_repeat(7,var(--cell))] gap-[3px]" role="row">
                          <span className="h-4 text-[0.65rem] text-[color:color-mix(in_srgb,var(--foreground)_55%,transparent)] whitespace-nowrap w-[var(--cell)] overflow-visible">
                            {firstOfMonth ? MONTHS[parseInt(firstOfMonth.slice(5, 7), 10) - 1] : ""}
                          </span>
                          {week.map((d, i) => {
                            if (!d) return <span key={i} className="w-[var(--cell)] h-[var(--cell)]" />;
                            const day = byDate.get(d);
                            const lvl = level(day?.pages ?? 0);
                            const label = `${longDate(d)}: ${day ? `${day.pages} pages` : "no reading"}`;
                            return (
                              <button
                                key={d}
                                type="button"
                                role="gridcell"
                                title={label}
                                aria-label={label}
                                aria-pressed={picked === d}
                                onClick={() => setPicked(picked === d ? null : d)}
                                className={cn(
                                  "w-[var(--cell)] h-[var(--cell)] rounded-[3px] transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                                  LEVEL_BG[lvl],
                                  picked === d && "ring-2 ring-[var(--heading-text)] ring-offset-1 ring-offset-[var(--card-bg)]"
                                )}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-[color:color-mix(in_srgb,var(--foreground)_70%,transparent)]">
                <div className="min-h-[1.25rem]" aria-live="polite">
                  {pickedDay ? (
                    <span>
                      <span className="font-semibold text-[var(--heading-text)]">{longDate(pickedDay.date)}</span>
                      {pickedDay.pages > 0 || pickedDay.books.length > 0
                        ? ` · ${pickedDay.pages} pages · ${pickedDay.books.join(", ")}`
                        : " · no reading logged"}
                    </span>
                  ) : (
                    <span>Tap a day to see what you read.</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  Less
                  {LEVEL_BG.map((bg, i) => (
                    <span key={i} className={cn("w-[0.8rem] h-[0.8rem] rounded-[3px]", bg)} />
                  ))}
                  More
                </div>
              </div>

              <Weekdays pages={data.heatmap.byWeekday} />
            </div>
          </div>

          {/* Pace */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-sm p-4 space-y-4">
              <h3 className="font-serif text-lg font-bold text-[var(--heading-text)] flex items-center gap-2">
                <Gauge className="w-5 h-5 text-[var(--accent)]" />
                Pace
              </h3>
              {data.pace.fastest ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Pages a day" value={data.pace.averagePagesPerDay?.toFixed(1) ?? "—"} hint="average per finished book" />
                    <Stat label="Days a book" value={data.pace.averageDays !== null ? String(Math.round(data.pace.averageDays)) : "—"} hint="start to finish" />
                  </div>
                  <Extreme icon={<Rabbit className="w-5 h-5" />} label="Fastest" book={data.pace.fastest} />
                  {data.pace.slowest && <Extreme icon={<Turtle className="w-5 h-5" />} label="Slowest" book={data.pace.slowest} />}
                  {data.pace.byFormat.length > 1 && <ByFormat rows={data.pace.byFormat} />}
                </>
              ) : (
                <p className="text-sm text-[color:color-mix(in_srgb,var(--foreground)_65%,transparent)]">
                  Finish a book with a start date this year to see your pace.
                </p>
              )}
            </div>

            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-sm p-4 space-y-3">
              <h3 className="font-serif text-lg font-bold text-[var(--heading-text)] flex items-center gap-2">
                <Hourglass className="w-5 h-5 text-[var(--accent)]" />
                On pace to finish
              </h3>
              {data.pace.current.length === 0 ? (
                <p className="text-sm text-[color:color-mix(in_srgb,var(--foreground)_65%,transparent)]">Nothing being read right now.</p>
              ) : (
                <ul className="space-y-3">
                  {data.pace.current.map((c) => (
                    <li key={c.bookId} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link href={`/books/${c.bookId}`} className="font-semibold text-[var(--heading-text)] hover:underline line-clamp-1">
                          {c.title}
                        </Link>
                        <span className="text-xs whitespace-nowrap text-[color:color-mix(in_srgb,var(--foreground)_70%,transparent)]">
                          {c.estimatedFinish ? (
                            <>
                              by <span className="font-semibold text-[var(--accent)]">{shortDate(c.estimatedFinish)}</span>
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Snail className="w-3.5 h-3.5" /> no recent reading
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)] overflow-hidden">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, c.percentage)}%` }} />
                      </div>
                      <div className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)]">
                        {Math.round(c.percentage)}%{c.pagesLeft > 0 && ` · ${c.pagesLeft.toLocaleString()} pages left`}
                        {c.pagesPerDay !== null && ` · ${c.pagesPerDay} pages a day lately`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Tile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 text-[0.7rem] uppercase tracking-wider font-semibold text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)]">
        <span className="text-[var(--accent)]">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-2xl font-serif font-bold text-[var(--heading-text)]">{value}</div>
      {hint && <div className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_55%,transparent)]">{hint}</div>}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-[var(--border-color)] bg-[color:color-mix(in_srgb,var(--card-bg-emphasis)_50%,transparent)] px-3 py-2">
      <div className="text-[0.7rem] uppercase tracking-wider font-semibold text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)]">{label}</div>
      <div className="text-2xl font-serif font-bold text-[var(--heading-text)]">{value}</div>
      <div className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_55%,transparent)]">{hint}</div>
    </div>
  );
}

function Extreme({ icon, label, book }: { icon: React.ReactNode; label: string; book: PaceBook }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-[color:color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[0.7rem] uppercase tracking-wider font-semibold text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)]">{label}</div>
        <Link href={`/books/${book.bookId}`} className="font-semibold text-[var(--heading-text)] hover:underline line-clamp-1">
          {book.title}
        </Link>
        <div className="text-xs text-[color:color-mix(in_srgb,var(--foreground)_65%,transparent)]">
          {book.pagesPerDay} pages a day · {book.pages.toLocaleString()} pages in {book.days} {book.days === 1 ? "day" : "days"}
        </div>
      </div>
    </div>
  );
}

function ByFormat({ rows }: { rows: Insights["pace"]["byFormat"] }) {
  const max = Math.max(...rows.map((r) => r.averagePagesPerDay), 1);
  return (
    <div className="space-y-2 pt-1">
      <div className="text-[0.7rem] uppercase tracking-wider font-semibold text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)]">Pages a day by format</div>
      {rows.map((r) => (
        <div key={r.format} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm">
          <span className="text-[var(--foreground)]">{FORMAT_LABEL[r.format]}</span>
          <div className="h-2.5 rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)] overflow-hidden">
            <div className={cn("h-full rounded-full", FORMAT_BAR[r.format])} style={{ width: `${(r.averagePagesPerDay / max) * 100}%` }} />
          </div>
          <span className="font-mono text-xs text-[color:color-mix(in_srgb,var(--foreground)_75%,transparent)] whitespace-nowrap">
            {r.averagePagesPerDay} · {r.books} {r.books === 1 ? "book" : "books"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Weekdays({ pages }: { pages: number[] }) {
  const max = Math.max(...pages, 1);
  const best = pages.indexOf(Math.max(...pages));
  if (pages.every((p) => p === 0)) return null;
  return (
    <div className="pt-2 border-t border-[var(--border-color)]">
      <div className="text-[0.7rem] uppercase tracking-wider font-semibold text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)] mb-2">
        Pages by weekday · most on {WEEKDAYS[best]}
      </div>
      <div className="grid grid-cols-7 gap-2 items-end h-16">
        {pages.map((p, i) => (
          <div key={i} className="flex flex-col items-center gap-1 h-full justify-end" title={`${WEEKDAYS[i]}: ${p.toLocaleString()} pages`}>
            <div
              className={cn("w-full max-w-[2.5rem] rounded-t", i === best ? "bg-[var(--accent)]" : "bg-[color:color-mix(in_srgb,var(--accent)_45%,transparent)]")}
              style={{ height: `${Math.max(4, (p / max) * 100)}%` }}
            />
            <span className="text-[0.65rem] text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)]">{WEEKDAYS[i]![0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
