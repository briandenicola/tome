import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { randomBytes } from "crypto";

/**
 * Covers of books added by hand: image files in a `covers` folder next to the database (so they're kept, and backed
 * up, with it). The book row keeps the file name. Calibre books' covers stay in the Calibre library.
 */

/** Largest cover accepted, in bytes. */
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

const TYPES = [
  { type: "image/jpeg", ext: "jpg", test: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", ext: "png", test: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/gif", ext: "gif", test: (b: Buffer) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  {
    type: "image/webp",
    ext: "webp",
    test: (b: Buffer) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
] as const;

export class CoverError extends Error {}

/** The folder covers are kept in. */
export function coversDir(): string {
  return join(dirname(process.env.DATABASE_PATH || "./data/tome.db"), "covers");
}

/** The image type of these bytes, judged by their content (never by a name or a header someone sent). */
export function detectImageType(bytes: Buffer): { type: string; ext: string } | null {
  const t = TYPES.find((t) => t.test(bytes));
  return t ? { type: t.type, ext: t.ext } : null;
}

/** Checks an image and saves it as a book's cover. Returns the new file name. */
export function saveCover(bookId: number, bytes: Buffer): string {
  if (bytes.length === 0) throw new CoverError("The cover is empty. Choose an image file.");
  if (bytes.length > MAX_COVER_BYTES) throw new CoverError("The cover is over 5 MB. Choose a smaller image.");
  const kind = detectImageType(bytes);
  if (!kind) throw new CoverError("The cover isn't a JPEG, PNG, GIF or WebP image.");
  const dir = coversDir();
  mkdirSync(dir, { recursive: true });
  // A new name each time, so browsers and the cover cache never show the old image.
  const file = `${bookId}-${randomBytes(4).toString("hex")}.${kind.ext}`;
  writeFileSync(join(dir, file), bytes);
  return file;
}

function pathOf(file: string): string | null {
  const dir = resolve(coversDir());
  const full = resolve(dir, file);
  return full.startsWith(dir + sep) ? full : null;
}

/** A saved cover's bytes and type, or null when the file is gone. */
export function readCover(file: string): { bytes: Buffer; type: string } | null {
  const full = pathOf(file);
  if (!full || !existsSync(full)) return null;
  const bytes = readFileSync(full);
  const kind = detectImageType(bytes);
  return kind ? { bytes, type: kind.type } : null;
}

/** Removes a saved cover; a missing file is fine. */
export function deleteCover(file: string | null | undefined): void {
  if (!file) return;
  const full = pathOf(file);
  if (!full) return;
  try {
    unlinkSync(full);
  } catch {
    /* already gone */
  }
}
