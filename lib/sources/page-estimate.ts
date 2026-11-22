/**
 * A page count for an audiobook that has none: from its length, at the pace narrators read and the words a printed
 * page holds. About 155 words a minute, about 300 words a page: some 31 pages an hour, so 30 is used. Close enough
 * for streaks and pages-read stats to count listening; a person can set the real count at any time.
 */
export const ESTIMATED_PAGES_PER_HOUR = 30;

export function estimatePagesFromDuration(seconds: number | undefined | null): number | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.max(1, Math.round((seconds / 3600) * ESTIMATED_PAGES_PER_HOUR));
}
