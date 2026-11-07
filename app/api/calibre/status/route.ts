import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Whether a Calibre library is set up (CALIBRE_DB_PATH). Without one, Tome runs on books added by hand. */
export async function GET() {
  return NextResponse.json({ configured: !!process.env.CALIBRE_DB_PATH?.trim() });
}
