import { getLogger } from "@/lib/logger";

/**
 * Revalidates the pages that show a book's reading state, after a change to it.
 *
 * `revalidatePath` only works while Next.js is handling a request. Changes made by the background progress sync
 * (Audiobookshelf, Grimmory) happen outside one, and Next throws "static generation store missing" there. Those
 * pages are client-rendered and load their data from the API, so there's nothing cached to clear: skip quietly.
 */
export async function revalidateBookPages(bookId: number, source: string): Promise<void> {
  try {
    // Lazy import to avoid mock pollution in tests
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/"); // Dashboard
    revalidatePath("/library"); // Library page
    revalidatePath("/stats"); // Stats page
    revalidatePath("/journal"); // Journal page
    revalidatePath(`/books/${bookId}`); // Book detail page
    revalidatePath("/series"); // Series pages (list and detail)
  } catch (error) {
    if (error instanceof Error && error.message.includes("static generation store missing")) {
      getLogger().debug({ bookId }, `[${source}] No request in progress; skipped page revalidation`);
      return;
    }
    getLogger().error({ err: error }, `[${source}] Failed to invalidate cache`);
    // Don't fail the request if cache invalidation fails
  }
}
