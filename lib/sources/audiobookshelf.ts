import { baseUrl, requestImage, requestJson, type ReadingSource, type SourceItem } from "./types";

/**
 * Audiobookshelf: listening (and ebook) progress for the user whose API key is set, from GET /api/me/progress.
 * AUDIOBOOKSHELF_URL and AUDIOBOOKSHELF_API_KEY (Settings → Users → your user → API keys, or the user's API token).
 */

/** One entry of /api/me/progress, as far as Tome reads it. */
export interface AbsMediaProgress {
  libraryItemId?: string | null;
  episodeId?: string | null;
  mediaItemType?: string;
  duration?: number;
  progress?: number;
  ebookProgress?: number | null;
  isFinished?: boolean;
  lastUpdate?: number;
  startedAt?: number;
  finishedAt?: number | null;
}

const pct = (fraction: number) => Math.max(0, Math.min(100, Math.round(fraction * 1000) / 10));

/** Maps /api/me/progress to items. Podcast episodes are left out: Tome tracks books. Pure, for tests. */
export function mapAbsProgress(body: { mediaProgress?: AbsMediaProgress[] }): SourceItem[] {
  const out: SourceItem[] = [];
  for (const p of body.mediaProgress ?? []) {
    if (!p.libraryItemId || p.episodeId || (p.mediaItemType && p.mediaItemType !== "book")) continue;
    // An audiobook's progress is through its audio; an ebook-only item has ebookProgress instead.
    const fraction = p.duration && p.duration > 0 ? (p.progress ?? 0) : (p.ebookProgress ?? p.progress ?? 0);
    const progress = p.isFinished ? 100 : pct(fraction);
    if (progress <= 0 && !p.isFinished) continue;
    out.push({
      externalId: p.libraryItemId,
      title: "",
      authors: [],
      progress,
      finished: !!p.isFinished,
      ...(p.finishedAt && { finishedAt: new Date(p.finishedAt) }),
      ...(p.lastUpdate && { lastUpdate: new Date(p.lastUpdate) }),
    });
  }
  return out;
}

/** Fills an item from GET /api/items/<id>. Pure, for tests. */
export function mapAbsItem(item: SourceItem, body: unknown): SourceItem {
  const meta = ((body as { media?: { metadata?: Record<string, unknown> } })?.media?.metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const authors = Array.isArray(meta.authors)
    ? meta.authors.map((a) => str((a as { name?: unknown })?.name)).filter((a): a is string => !!a)
    : (str(meta.authorName)?.split(/\s*,\s*/) ?? []);
  const series = Array.isArray(meta.series) ? (meta.series[0] as { name?: unknown; sequence?: unknown } | undefined) : undefined;
  const seriesIndex = series && Number.parseFloat(String(series.sequence ?? ""));
  return {
    ...item,
    title: str(meta.title) ?? (item.title || "Untitled"),
    authors: authors.length ? authors : item.authors,
    ...(str(meta.isbn) && { isbn: str(meta.isbn) }),
    ...(str(meta.publisher) && { publisher: str(meta.publisher) }),
    ...(str(meta.description) && { description: str(meta.description) }),
    ...(series && str(series.name) && { series: str(series.name) }),
    ...(seriesIndex !== undefined && Number.isFinite(seriesIndex) && { seriesIndex: seriesIndex as number }),
  };
}

export const audiobookshelf: ReadingSource = {
  id: "audiobookshelf",
  name: "Audiobookshelf",
  configured: () => !!baseUrl(process.env.AUDIOBOOKSHELF_URL) && !!process.env.AUDIOBOOKSHELF_API_KEY?.trim(),

  async items() {
    const body = await requestJson<{ mediaProgress?: AbsMediaProgress[] }>(this.name, `${base()}/api/me/progress`, { headers: auth() });
    return mapAbsProgress(body);
  },

  async details(item) {
    const body = await requestJson<unknown>(this.name, `${base()}/api/items/${encodeURIComponent(item.externalId)}`, { headers: auth() });
    return mapAbsItem(item, body);
  },

  cover: (item) => requestImage(`${base()}/api/items/${encodeURIComponent(item.externalId)}/cover`, auth()),
};

function base() {
  return baseUrl(process.env.AUDIOBOOKSHELF_URL)!;
}

function auth() {
  return { authorization: `Bearer ${process.env.AUDIOBOOKSHELF_API_KEY!.trim()}` };
}
