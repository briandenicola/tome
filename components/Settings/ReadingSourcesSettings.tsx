"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Headphones, Link2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/Utilities/Button";
import { toast } from "@/utils/toast";

interface SourceLinkView {
  id: number;
  externalId: string;
  title: string;
  bookId: number | null;
  bookTitle: string | null;
  needsPages: boolean;
  matchedBy: "isbn" | "title" | "added" | "person" | null;
  lastProgress: number;
  lastFinished: boolean;
  lastSeenAt: string;
}

interface SourceView {
  id: "audiobookshelf" | "grimmory";
  name: string;
  configured: boolean;
  sync: { baselinedAt: string | null; lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null; lastSummary: string | null } | null;
  links: SourceLinkView[];
}

const KEY = ["reading-sources"];

const SETUP: Record<SourceView["id"], string> = {
  audiobookshelf: "AUDIOBOOKSHELF_URL and AUDIOBOOKSHELF_API_KEY",
  grimmory: "GRIMMORY_URL, GRIMMORY_USERNAME and GRIMMORY_PASSWORD",
};

const MATCHED: Record<NonNullable<SourceLinkView["matchedBy"]>, string> = {
  isbn: "matched by ISBN",
  title: "matched by title and author",
  added: "added to Tome",
  person: "linked by you",
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Tome answered ${res.status}. Try again.`);
  return body as T;
}

/**
 * Reading apps Tome takes progress from (Audiobookshelf, Grimmory with its Kobo sync): whether each is set up, how its
 * last sync went, and which Tome book each of its books counts toward, with a way to fix a wrong match.
 */
export function ReadingSourcesSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: KEY,
    queryFn: () => call<{ intervalMinutes: number; sources: SourceView[] }>("/api/sources"),
  });

  const sync = useMutation({
    mutationFn: (id: string) => call<{ summary: string }>(`/api/sources/${id}/sync`, { method: "POST" }),
    onSuccess: (res) => toast.success(res.summary),
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  });

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-md p-6">
      <div className="flex items-center gap-3 mb-4">
        <Headphones className="w-6 h-6 text-[var(--accent)]" />
        <h3 className="text-xl font-serif font-bold text-[var(--heading-text)]">Reading apps</h3>
      </div>
      <p className="text-sm text-[var(--subheading-text)] mb-4 font-medium">
        Tome logs your progress from these apps{data ? ` every ${data.intervalMinutes} minutes` : ""}, as a percentage. The
        first sync only notes where each book is; reading after that is logged. A book Tome doesn&apos;t have is added.
      </p>

      {isLoading && <div className="h-4 bg-[var(--border-color)] rounded animate-pulse w-48" />}
      {error && <p className="text-sm text-[var(--foreground)]/70">The reading apps couldn&apos;t be loaded. Refresh to try again.</p>}

      <div className="space-y-6">
        {data?.sources.map((s) => (
          <section key={s.id} className="border-t border-[var(--border-color)] pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold text-[var(--foreground)]">{s.name}</h4>
                <p className="text-sm text-[var(--foreground)]/70">
                  {!s.configured
                    ? `Not set up. Set ${SETUP[s.id]} in Tome's environment, then restart Tome.`
                    : s.sync?.lastRunAt
                      ? `Last synced ${formatDistanceToNow(new Date(s.sync.lastRunAt), { addSuffix: true })}${s.sync.lastSummary ? `: ${s.sync.lastSummary}` : ""}`
                      : "Not synced yet."}
                </p>
                {s.configured && s.sync?.lastError && (
                  <p className="text-sm text-red-600 dark:text-red-500 mt-1">{s.sync.lastError}</p>
                )}
              </div>
              {s.configured && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => sync.mutate(s.id)}
                  disabled={sync.isPending}
                  icon={<RefreshCw className={`w-4 h-4${sync.isPending && sync.variables === s.id ? " animate-spin" : ""}`} />}
                >
                  Sync now
                </Button>
              )}
            </div>

            {s.links.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--accent)]">
                  {s.links.length} {s.links.length === 1 ? "book" : "books"} from {s.name}
                </summary>
                <ul className="divide-y divide-[var(--border-color)] mt-2">
                  {s.links.map((l) => (
                    <LinkRow key={l.id} link={l} />
                  ))}
                </ul>
              </details>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function LinkRow({ link }: { link: SourceLinkView }) {
  const queryClient = useQueryClient();
  const [changing, setChanging] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ id: number; title: string; authors: string[] }>>([]);

  const relink = useMutation({
    mutationFn: (body: { bookId: number } | { addAsNew: true }) =>
      call(`/api/sources/links/${link.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Linked. New progress from it goes to that book.");
      setChanging(false);
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const find = async () => {
    try {
      const res = await call<{ books: Array<{ id: number; title: string; authors: string[] }> }>(
        `/api/books?search=${encodeURIComponent(search)}&limit=8`
      );
      setResults(res.books);
      if (res.books.length === 0) toast.info("No Tome book matches that.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't search.");
    }
  };

  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[var(--foreground)] truncate" title={link.title}>
            {link.title}
          </p>
          <p className="text-[var(--foreground)]/70">
            {link.needsPages ? "not logged yet" : link.lastFinished ? "finished" : `${Math.round(link.lastProgress)}%`} ·{" "}
            {link.bookId !== null ? (
              <>
                <Link href={`/books/${link.bookId}`} className="text-[var(--accent)] hover:underline">
                  {link.bookTitle ?? "Tome book"}
                </Link>
                {link.matchedBy && `, ${MATCHED[link.matchedBy]}`}
                {link.needsPages && (
                  <span className="text-amber-700 dark:text-amber-400">
                    {" "}
                    · needs a page count: set it on the book&apos;s page to start logging
                  </span>
                )}
              </>
            ) : (
              "not in Tome yet: added when there's new reading"
            )}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setChanging((c) => !c)} icon={<Link2 className="w-4 h-4" />}>
          {changing ? "Cancel" : "Change"}
        </Button>
      </div>
      {changing && (
        <div className="mt-2 space-y-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void find();
            }}
          >
            <input
              className="flex-1 px-3 py-1.5 rounded-md border border-[var(--border-color)] bg-[var(--background)] text-[var(--foreground)]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find the Tome book by title or author"
              aria-label="Find the Tome book"
            />
            <Button type="submit" variant="secondary" size="sm" disabled={!search.trim()}>
              Find
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={relink.isPending} onClick={() => relink.mutate({ addAsNew: true })}>
              Add as new book
            </Button>
          </form>
          {results.length > 0 && (
            <ul className="space-y-1">
              {results.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="text-left text-[var(--accent)] hover:underline disabled:opacity-50"
                    disabled={relink.isPending}
                    onClick={() => relink.mutate({ bookId: b.id })}
                  >
                    {b.title}
                    {b.authors.length > 0 && <span className="text-[var(--foreground)]/70"> · {b.authors.join(", ")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
