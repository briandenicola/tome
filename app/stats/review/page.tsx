"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  Feather,
  Flag,
  Flame,
  Layers,
  PartyPopper,
  Printer,
  Rabbit,
  Ruler,
  Star,
  Tag,
  Trophy,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { getCoverUrl } from "@/lib/utils/cover-url";
import { usePageTitle } from "@/lib/hooks/usePageTitle";

type Format = "ebook" | "audiobook" | "print";

interface ReviewBook {
  bookId: number;
  title: string;
  authors: string[];
  pages: number | null;
  rating: number | null;
  finishedDate: string;
  days: number | null;
  format: Format | null;
  lastSynced: string | null;
}

interface YearReview {
  year: number;
  totals: { books: number; pages: number; readingDays: number; longestRun: number; averageRating: number | null; rereads: number; authors: number };
  months: Array<{ month: number; books: ReviewBook[] }>;
  highlights: {
    first: ReviewBook | null;
    last: ReviewBook | null;
    longest: ReviewBook | null;
    shortest: ReviewBook | null;
    fastest: (ReviewBook & { pagesPerDay: number }) | null;
    favourites: ReviewBook[];
    busiestMonth: { month: number; books: number } | null;
  };
  topAuthors: Array<{ name: string; books: number }>;
  topTags: Array<{ name: string; books: number }>;
  formats: Record<Format | "unknown", number>;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FORMAT_LABEL: Record<Format, string> = { ebook: "Ebook", audiobook: "Audiobook", print: "Print" };
const FORMAT_BAR: Record<Format, string> = {
  ebook: "bg-sky-700/70 dark:bg-sky-400/70",
  audiobook: "bg-amber-600/80 dark:bg-amber-400/70",
  print: "bg-emerald-700/70 dark:bg-emerald-400/70",
};
// Muted text at a few strengths. Written out in full so Tailwind sees each class.
const MUTED: Record<number, string> = {
  45: "text-[color:color-mix(in_srgb,var(--foreground)_45%,transparent)]",
  50: "text-[color:color-mix(in_srgb,var(--foreground)_50%,transparent)]",
  60: "text-[color:color-mix(in_srgb,var(--foreground)_60%,transparent)]",
  65: "text-[color:color-mix(in_srgb,var(--foreground)_65%,transparent)]",
  70: "text-[color:color-mix(in_srgb,var(--foreground)_70%,transparent)]",
  75: "text-[color:color-mix(in_srgb,var(--foreground)_75%,transparent)]",
};
const muted = (n: keyof typeof MUTED) => MUTED[n]!;
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function ReviewContent() {
  const params = useSearchParams();
  const router = useRouter();
  const thisYear = new Date().getFullYear();
  const yearParam = parseInt(params?.get("year") ?? "", 10);
  const year = Number.isInteger(yearParam) && yearParam > 1900 && yearParam <= thisYear ? yearParam : thisYear;
  usePageTitle(`${year} in Books`);

  const [data, setData] = useState<YearReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/stats/review?year=${year}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((d: YearReview) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year]);

  const go = (y: number) => router.replace(`/stats/review?year=${y}`);

  return (
    <div className="space-y-8 print:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/stats" className={cn("inline-flex items-center gap-1.5 text-sm font-semibold hover:text-[var(--accent)]", muted(75))}>
          <ArrowLeft className="w-4 h-4" />
          Stats
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm">
            <button type="button" aria-label="Previous year" onClick={() => go(year - 1)} className="p-2 hover:text-[var(--accent)]">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-sm font-semibold tabular-nums">{year}</span>
            <button
              type="button"
              aria-label="Next year"
              disabled={year >= thisYear}
              onClick={() => go(year + 1)}
              className="p-2 hover:text-[var(--accent)] disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <a
            href={`/api/reports/read?year=${year}&format=md`}
            download
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm hover:bg-[var(--card-bg-emphasis)]"
          >
            <Download className="w-4 h-4" />
            Markdown
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm hover:bg-[var(--card-bg-emphasis)]"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4" aria-busy="true">
          <div className="h-56 rounded-xl bg-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)] animate-pulse" />
          <div className="h-72 rounded-xl bg-[color:color-mix(in_srgb,var(--foreground)_8%,transparent)] animate-pulse" />
        </div>
      ) : error || !data ? (
        <p className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-6 text-sm text-red-600">Couldn&apos;t load your year in review.</p>
      ) : data.totals.books === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--card-bg)] p-12 text-center">
          <BookOpen className="w-12 h-12 mx-auto text-[var(--accent)]" />
          <h1 className="mt-4 text-3xl font-serif font-bold text-[var(--heading-text)]">{year} in Books</h1>
          <p className={cn("mt-2", muted(65))}>No books finished in {year} yet. Your review fills in as you finish books.</p>
        </div>
      ) : (
        <Review data={data} />
      )}
    </div>
  );
}

function Review({ data }: { data: YearReview }) {
  const { year, totals, months, highlights: h } = data;
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-md">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_15%_20%,color-mix(in_srgb,var(--light-accent)_45%,transparent),transparent_45%),radial-gradient(circle_at_85%_90%,color-mix(in_srgb,var(--accent)_30%,transparent),transparent_50%)]"
        />
        <div className="relative px-6 py-8 sm:px-10 sm:py-10 space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] font-semibold text-[var(--accent)] flex items-center gap-2">
              <PartyPopper className="w-4 h-4" /> Year in review
            </p>
            <h1 className="mt-2 text-5xl sm:text-6xl font-serif font-bold text-[var(--heading-text)]">{year} in Books</h1>
            <p className={cn("mt-3 max-w-2xl text-lg font-serif", muted(75))}>
              {sentence(data)}
            </p>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <Big label="Books" value={totals.books} />
            <Big label="Pages" value={totals.pages} />
            <Big label="Reading days" value={totals.readingDays} />
            <Big label="Longest run" value={totals.longestRun} suffix={totals.longestRun === 1 ? "day" : "days"} />
            <Big label="Authors" value={totals.authors} />
            <Big label="Avg rating" value={totals.averageRating ?? "—"} star={totals.averageRating !== null} />
          </dl>
        </div>
      </section>

      {/* Month by month */}
      <section aria-labelledby="months-heading" className="space-y-3">
        <h2 id="months-heading" className="text-2xl font-serif font-bold text-[var(--heading-text)] flex items-center gap-2">
          <CalendarRange className="w-6 h-6 text-[var(--accent)]" />
          Month by month
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 print:grid-cols-3">
          {months.map((m) => (
            <div
              key={m.month}
              className={cn(
                "rounded-lg border border-[var(--border-color)] p-3 break-inside-avoid",
                m.books.length ? "bg-[var(--card-bg)]" : "bg-[color:color-mix(in_srgb,var(--card-bg)_50%,transparent)]",
                h.busiestMonth?.month === m.month && "ring-2 ring-[var(--accent)]"
              )}
            >
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-serif font-bold text-[var(--heading-text)]">{MONTHS[m.month - 1]}</h3>
                <span className={cn("text-xs font-semibold", m.books.length ? "text-[var(--accent)]" : muted(45))}>
                  {m.books.length ? `${m.books.length} ${m.books.length === 1 ? "book" : "books"}` : "—"}
                </span>
              </div>
              {m.books.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {m.books.map((b) => (
                    <Link key={`${b.bookId}-${b.finishedDate}`} href={`/books/${b.bookId}`} title={`${b.title} · ${shortDate(b.finishedDate)}`}>
                      <Cover book={b} className="w-11 h-16 hover:-translate-y-0.5 transition-transform" />
                    </Link>
                  ))}
                </div>
              ) : (
                <p className={cn("text-xs italic", muted(45))}>A quiet month.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Highlights */}
      <section aria-labelledby="highlights-heading" className="space-y-3">
        <h2 id="highlights-heading" className="text-2xl font-serif font-bold text-[var(--heading-text)] flex items-center gap-2">
          <Trophy className="w-6 h-6 text-[var(--accent)]" />
          Highlights
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {h.first && <Highlight icon={<Flag />} label="First of the year" book={h.first} detail={`Finished ${shortDate(h.first.finishedDate)}`} />}
          {h.last && <Highlight icon={<Feather />} label="Latest finish" book={h.last} detail={`Finished ${shortDate(h.last.finishedDate)}`} />}
          {h.longest && <Highlight icon={<Ruler />} label="Longest book" book={h.longest} detail={`${h.longest.pages!.toLocaleString()} pages`} />}
          {h.shortest && <Highlight icon={<Layers />} label="Shortest book" book={h.shortest} detail={`${h.shortest.pages!.toLocaleString()} pages`} />}
          {h.fastest && (
            <Highlight
              icon={<Rabbit />}
              label="Fastest read"
              book={h.fastest}
              detail={`${h.fastest.pagesPerDay} pages a day · ${h.fastest.days} ${h.fastest.days === 1 ? "day" : "days"}`}
            />
          )}
          {h.busiestMonth && (
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 flex items-center gap-4">
              <span className="w-12 h-12 rounded-full flex items-center justify-center bg-[color:color-mix(in_srgb,var(--accent)_15%,transparent)] text-[var(--accent)]">
                <Flame className="w-6 h-6" />
              </span>
              <div>
                <div className={cn("text-[0.7rem] uppercase tracking-wider font-semibold", muted(60))}>Busiest month</div>
                <div className="text-xl font-serif font-bold text-[var(--heading-text)]">{MONTHS[h.busiestMonth.month - 1]}</div>
                <div className={cn("text-sm", muted(65))}>
                  {h.busiestMonth.books} {h.busiestMonth.books === 1 ? "book" : "books"} finished
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Favourites */}
      {h.favourites.length > 0 && (
        <section aria-labelledby="favourites-heading" className="space-y-3">
          <h2 id="favourites-heading" className="text-2xl font-serif font-bold text-[var(--heading-text)] flex items-center gap-2">
            <Star className="w-6 h-6 fill-[var(--accent)] text-[var(--accent)]" />
            Favourites
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {h.favourites.map((b) => (
              <Link key={`${b.bookId}-${b.finishedDate}`} href={`/books/${b.bookId}`} className="group space-y-1.5">
                <Cover book={b} className="w-full aspect-[2/3] group-hover:-translate-y-1 transition-transform shadow-lg" />
                <div className="text-sm font-semibold text-[var(--heading-text)] line-clamp-2 leading-snug">{b.title}</div>
                <Stars rating={b.rating ?? 0} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Authors, tags, formats */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Ranking icon={<Feather className="w-5 h-5" />} title="Most-read authors" rows={data.topAuthors} />
        <Ranking
          icon={<Tag className="w-5 h-5" />}
          title="Top tags"
          rows={data.topTags}
          href={(name) => `/library?tags=${encodeURIComponent(name)}`}
          empty="No tags on this year's books."
        />
        <Formats formats={data.formats} total={totals.books} />
      </section>
    </>
  );
}

/** One line that sums the year up. */
function sentence(data: YearReview): string {
  const { totals, topAuthors } = data;
  const parts = [`${totals.books} ${totals.books === 1 ? "book" : "books"} and ${totals.pages.toLocaleString()} pages`];
  if (totals.readingDays) parts.push(`across ${totals.readingDays} reading days`);
  let s = `You read ${parts.join(" ")}.`;
  // Name an author only when they clearly lead: a tie isn't a favourite.
  if (topAuthors[0] && topAuthors[0].books > 1 && (topAuthors[1]?.books ?? 0) < topAuthors[0].books) s += ` ${topAuthors[0].name} kept you company most, with ${topAuthors[0].books} books.`;
  if (totals.rereads) s += ` You went back to ${totals.rereads} old ${totals.rereads === 1 ? "friend" : "friends"}.`;
  return s;
}

function Big({ label, value, suffix, star = false }: { label: string; value: number | string; suffix?: string; star?: boolean }) {
  return (
    <div className="rounded-lg bg-[color:color-mix(in_srgb,var(--card-bg)_75%,transparent)] border border-[var(--border-color)] px-4 py-3 backdrop-blur-sm">
      <dt className={cn("text-[0.7rem] uppercase tracking-wider font-semibold", muted(60))}>{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-serif font-bold text-[var(--heading-text)] tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</span>
        {suffix && <span className={cn("text-sm", muted(60))}>{suffix}</span>}
        {star && <Star className="w-4 h-4 fill-[var(--accent)] text-[var(--accent)] self-center" />}
      </dd>
    </div>
  );
}

function Cover({ book, className }: { book: ReviewBook; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cn("relative overflow-hidden rounded-sm shadow-md bg-[color:color-mix(in_srgb,var(--light-accent)_30%,transparent)] flex items-center justify-center", className)}>
      {failed ? (
        <BookOpen className="w-5 h-5 text-[var(--accent)]" />
      ) : (
        <Image src={getCoverUrl(book.bookId, book.lastSynced)} alt={book.title} fill sizes="(min-width: 1024px) 140px, 30vw" className="object-cover" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

function Highlight({ icon, label, book, detail }: { icon: React.ReactNode; label: string; book: ReviewBook; detail: string }) {
  return (
    <Link href={`/books/${book.bookId}`} className="group rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
      <Cover book={book} className="w-14 h-20 flex-shrink-0" />
      <div className="min-w-0">
        <div className={cn("text-[0.7rem] uppercase tracking-wider font-semibold flex items-center gap-1.5 [&_svg]:w-3.5 [&_svg]:h-3.5 text-[var(--accent)]")}>
          {icon}
          {label}
        </div>
        <div className="font-semibold text-[var(--heading-text)] line-clamp-2 group-hover:underline">{book.title}</div>
        <div className={cn("text-sm font-serif line-clamp-1", muted(70))}>{book.authors.join(", ")}</div>
        <div className={cn("text-xs mt-0.5", muted(60))}>{detail}</div>
      </div>
    </Link>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex" role="img" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("w-3.5 h-3.5", n <= rating ? "fill-[var(--accent)] text-[var(--accent)]" : "text-[color:color-mix(in_srgb,var(--foreground)_20%,transparent)]")} />
      ))}
    </span>
  );
}

function Ranking({
  icon,
  title,
  rows,
  href,
  empty = "Nothing yet.",
}: {
  icon: React.ReactNode;
  title: string;
  rows: Array<{ name: string; books: number }>;
  href?: (name: string) => string;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.books));
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 space-y-3">
      <h3 className="font-serif text-lg font-bold text-[var(--heading-text)] flex items-center gap-2">
        <span className="text-[var(--accent)]">{icon}</span>
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className={cn("text-sm", muted(60))}>{empty}</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.name} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-2 text-sm">
              <span className={cn("font-mono text-xs", muted(50))}>{i + 1}</span>
              <div className="min-w-0">
                {href ? (
                  <Link href={href(r.name)} className="font-medium text-[var(--foreground)] hover:underline line-clamp-1">
                    {r.name}
                  </Link>
                ) : (
                  <span className="font-medium text-[var(--foreground)] line-clamp-1">{r.name}</span>
                )}
                <div className="mt-1 h-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)] overflow-hidden">
                  <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(r.books / max) * 100}%` }} />
                </div>
              </div>
              <span className={cn("font-mono text-xs", muted(70))}>{r.books}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Formats({ formats, total }: { formats: YearReview["formats"]; total: number }) {
  const known = (Object.keys(FORMAT_LABEL) as Format[]).filter((f) => formats[f] > 0);
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 space-y-3">
      <h3 className="font-serif text-lg font-bold text-[var(--heading-text)] flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-[var(--accent)]" />
        How you read
      </h3>
      {known.length === 0 ? (
        <p className={cn("text-sm", muted(60))}>Set a format on your reads to see how you read.</p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_10%,transparent)]">
            {known.map((f) => (
              <div key={f} className={FORMAT_BAR[f]} style={{ width: `${(formats[f] / total) * 100}%` }} />
            ))}
          </div>
          <ul className="space-y-1.5 text-sm">
            {known.map((f) => (
              <li key={f} className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <span className={cn("w-3 h-3 rounded-full", FORMAT_BAR[f])} />
                  {FORMAT_LABEL[f]}
                </span>
                <span className={cn("font-mono text-xs", muted(70))}>
                  {formats[f]} · {Math.round((formats[f] / total) * 100)}%
                </span>
              </li>
            ))}
            {formats.unknown > 0 && (
              <li className={cn("flex items-center justify-between", muted(60))}>
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_20%,transparent)]" />
                  Not set
                </span>
                <span className="font-mono text-xs">{formats.unknown}</span>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

export default function YearReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ReviewContent />
    </Suspense>
  );
}
