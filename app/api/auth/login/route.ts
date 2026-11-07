import { getLogger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import {
  checkPassword,
  clearLoginFailures,
  clientKey,
  createAuthResponse,
  isAuthEnabled,
  loginWait,
  recordLoginFailure,
} from "@/lib/auth";

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: "Authentication not enabled" }, { status: 400 });
  }

  // After too many wrong passwords from one client, it waits before trying again.
  const client = clientKey(request);
  const wait = loginWait(client);
  if (wait > 0) {
    return NextResponse.json(
      { error: `Too many wrong passwords. Try again in ${wait} seconds.` },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  try {
    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password required" }, { status: 400 });
    }

    if (checkPassword(password)) {
      clearLoginFailures(client);
      return createAuthResponse(request);
    }
    recordLoginFailure(client);
    getLogger().warn({ client }, "Sign-in failed: wrong password");
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch (error) {
    getLogger().error({ err: error }, "Login error");
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
