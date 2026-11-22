import type { BookFilter } from "@/lib/repositories/book.repository";

/**
 * The library's filters, read from a request's query string the same way for every endpoint that lists books: the
 * library page's list, and the ids behind "select all" for bulk actions.
 */
export function parseBookFilters(searchParams: URLSearchParams): { filters: BookFilter; sortBy?: string } {
  const tagsParam = searchParams.get("tags");
  const shelfParam = searchParams.get("shelf");
  const excludeShelfParam = searchParams.get("excludeShelfId");
  const showOrphaned = searchParams.get("showOrphaned") === "true";

  return {
    filters: {
      status: searchParams.get("status") || undefined,
      search: searchParams.get("search")?.trim() || undefined,
      tags: tagsParam ? tagsParam.split(",").map((t) => t.trim()) : undefined,
      rating: searchParams.get("rating") || undefined,
      shelfIds: shelfParam ? [parseInt(shelfParam)] : undefined,
      excludeShelfId: excludeShelfParam ? parseInt(excludeShelfParam) : undefined,
      showOrphaned,
      orphanedOnly: showOrphaned,
      noTags: searchParams.get("noTags") === "true",
    },
    sortBy: searchParams.get("sortBy") || undefined,
  };
}
