/**
 * Runs the source sync on a timer: a minute after Tome starts, then every SOURCE_SYNC_MINUTES (default 15).
 * Does nothing when no reading app is set up.
 */

let timer: ReturnType<typeof setInterval> | null = null;
let first: ReturnType<typeof setTimeout> | null = null;

export function syncIntervalMinutes(): number {
  const n = Number(process.env.SOURCE_SYNC_MINUTES);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 24 * 60) : 15;
}

/** Starts the timer. Messages go to Tome's log (production builds drop console.log). */
export async function startSourceSync(): Promise<void> {
  const { getLogger } = await import("@/lib/logger");
  const logger = getLogger();
  const log = (level: "info" | "warn", message: string) => logger[level](message);
  const { sourceSyncService } = await import("@/lib/services/source-sync.service");
  const configured = sourceSyncService.configured();
  if (configured.length === 0) {
    log("info", "No reading app set up (Audiobookshelf, Grimmory). Progress sync is off.");
    return;
  }
  stopSourceSync();
  const run = () => {
    sourceSyncService.syncAll().catch((error) => log("warn", `Progress sync failed: ${error instanceof Error ? error.message : error}`));
  };
  const minutes = syncIntervalMinutes();
  first = setTimeout(run, 60_000);
  timer = setInterval(run, minutes * 60_000);
  first.unref?.();
  timer.unref?.();
  log("info", `Progress sync on for ${configured.map((s) => s.name).join(" and ")}, every ${minutes} minutes.`);
}

export function stopSourceSync(): void {
  if (first) clearTimeout(first);
  if (timer) clearInterval(timer);
  first = timer = null;
}
