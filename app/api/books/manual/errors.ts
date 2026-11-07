import { NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { ManualBookError } from "@/lib/services/manual-book.service";

/** The response for an error from adding or changing a book by hand. */
export function manualBookError(error: unknown, action: string): NextResponse {
  if (error instanceof ManualBookError) return NextResponse.json({ error: error.message }, { status: error.status });
  getLogger().error({ err: error }, `Failed to ${action}`);
  return NextResponse.json({ error: `Couldn't ${action}. Try again; the log says why.` }, { status: 500 });
}

/** A JSON body, or null when the request has none or it isn't JSON. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function bookIdOf(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}
