import { getLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { getBookById } from "@/lib/db/calibre";
import { bookRepository } from "@/lib/repositories";
import { readCover, detectImageType } from "@/lib/covers/manual-covers";
import {
  coverCache,
  bookPathCache,
  clearCoverCache,
  clearBookPathCache,
  getCoverCacheStats,
  getBookPathCacheStats,
  type CacheStats,
} from "@/lib/cache/cover-cache";

export const dynamic = 'force-dynamic';

// Re-export cache functions for backward compatibility
export { clearCoverCache, clearBookPathCache, getCoverCacheStats, getBookPathCacheStats, type CacheStats };
// Helper function to serve the placeholder "no cover" image
function servePlaceholderImage() {
  const placeholderPath = path.join(process.cwd(), "public", "cover-fallback.png");
  const imageBuffer = readFileSync(placeholderPath);

  return new NextResponse(new Uint8Array(imageBuffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=604800", // 1 week
    },
  });
}

/** Serves a cached or freshly read image. */
function serveImage(buffer: Buffer, contentType: string, cache: "HIT" | "MISS") {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800", // 1 week; URLs carry ?t=<lastSynced> to bust it
      "X-Cache": cache,
    },
  });
}

/**
 * A book's cover, by Tome book id: the image uploaded for a book added by hand, or the cover in the Calibre library
 * for a Calibre book. Falls back to a placeholder.
 */
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  // NOTE: Query params like ?t=<timestamp> are used for cache busting on the client
  // but are intentionally ignored by the server. The server caches by bookId only.
  const params = await props.params;
  try {
    const bookId = parseInt(params.id, 10);
    if (isNaN(bookId)) {
      getLogger().error({ bookId: params.id }, "Invalid book ID");
      return servePlaceholderImage();
    }

    const cachedCover = coverCache.get(bookId);
    if (cachedCover) return serveImage(cachedCover.buffer, cachedCover.contentType, "HIT");

    const book = await bookRepository.findById(bookId);
    if (!book) return servePlaceholderImage();

    if (book.coverFile) {
      const cover = readCover(book.coverFile);
      if (!cover) {
        getLogger().warn({ bookId, coverFile: book.coverFile }, "Cover file missing");
        return servePlaceholderImage();
      }
      coverCache.set(bookId, cover.bytes, cover.type);
      return serveImage(cover.bytes, cover.type, "MISS");
    }

    if (book.calibreId === null) return servePlaceholderImage();
    const calibreId = book.calibreId;

    const CALIBRE_DB_PATH = process.env.CALIBRE_DB_PATH;
    if (!CALIBRE_DB_PATH) return servePlaceholderImage();

    // Extract library path from database path (metadata.db is in the library root)
    const libraryPath = path.dirname(CALIBRE_DB_PATH);

    // Check book path cache to avoid Calibre DB query
    let bookPath: string;
    let hasCover: boolean;

    const cachedBookPath = bookPathCache.get(calibreId);
    if (cachedBookPath) {
      bookPath = cachedBookPath.path;
      hasCover = cachedBookPath.hasCover;
    } else {
      // Look up the book in Calibre to get its path
      const calibreBook = getBookById(calibreId);

      if (!calibreBook) {
        getLogger().error({ bookId, calibreId }, "Book not found in Calibre");
        return servePlaceholderImage();
      }

      bookPath = calibreBook.path;
      hasCover = Boolean(calibreBook.has_cover);
      bookPathCache.set(calibreId, bookPath, hasCover);
    }

    if (!hasCover) return servePlaceholderImage();

    // Construct the file path
    const filePath = path.join(libraryPath, bookPath, "cover.jpg");

    // Security check: ensure the resolved path is still within the library
    const resolvedPath = path.resolve(filePath);
    const resolvedLibrary = path.resolve(libraryPath);

    if (!resolvedPath.startsWith(resolvedLibrary + path.sep)) {
      getLogger().error({ resolvedPath, resolvedLibrary }, "Invalid path - security check failed");
      return NextResponse.json({ error: "Invalid path" }, { status: 403 });
    }

    if (!existsSync(resolvedPath)) {
      getLogger().error({ resolvedPath }, "Image not found");
      return servePlaceholderImage();
    }

    const imageBuffer = readFileSync(resolvedPath);
    const contentType = detectImageType(imageBuffer)?.type ?? "image/jpeg";

    coverCache.set(bookId, imageBuffer, contentType);
    return serveImage(imageBuffer, contentType, "MISS");
  } catch (error) {
    getLogger().error({ err: error }, "Error serving cover image");
    return servePlaceholderImage();
  }
}
