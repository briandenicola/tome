import type { ReadingFormat } from "@/lib/db/schema/reading-sessions";

/** How each format is shown. */
export const FORMAT_LABELS: Record<ReadingFormat, string> = {
  ebook: "Ebook",
  audiobook: "Audiobook",
  print: "Print",
};

export function isReadingFormat(value: unknown): value is ReadingFormat {
  return value === "ebook" || value === "audiobook" || value === "print";
}

/**
 * A read's format: as recorded, else what the book's source says (an Audiobookshelf book is listened to, a Grimmory
 * book read as an ebook). Null when nothing says: a Calibre book can be read in any format.
 */
export function effectiveFormat(recorded: string | null | undefined, bookSource: string | null | undefined): ReadingFormat | null {
  if (isReadingFormat(recorded)) return recorded;
  if (bookSource === "audiobookshelf") return "audiobook";
  if (bookSource === "grimmory") return "ebook";
  return null;
}
