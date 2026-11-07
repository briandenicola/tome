import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

/**
 * Authentication for the web app and the API.
 *
 * With AUTH_PASSWORD set, signing in sets a session cookie that can't be forged: `v1.<expires>.<signature>`, signed
 * with a key made from a server secret and the password (so changing the password signs everyone out). The proxy
 * checks it on every page and every /api route; the API also takes API tokens (Authorization: Bearer). OPDS keeps
 * its own HTTP Basic auth.
 *
 * The server secret is AUTH_SECRET when set, otherwise a random one kept in `.auth-secret` next to the database,
 * made the first time it's needed.
 */

const AUTH_COOKIE_NAME = "tome-auth";
/** How long a sign-in lasts. */
export const SESSION_DAYS = 30;

export function isAuthEnabled(): boolean {
  const password = process.env.AUTH_PASSWORD;
  return !!password && password.trim() !== "";
}

export function getAuthPassword(): string {
  return process.env.AUTH_PASSWORD || "";
}

export function getAuthCookieName(): string {
  return AUTH_COOKIE_NAME;
}

/** Compares two strings in constant time, whatever their lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** Whether a password is the one in AUTH_PASSWORD. */
export function checkPassword(candidate: string): boolean {
  return isAuthEnabled() && safeEqual(candidate, getAuthPassword());
}

let cachedSecret: string | undefined;

/** The server secret sessions are signed with: AUTH_SECRET, or a random one kept next to the database. */
export function getAuthSecret(): string {
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (cachedSecret) return cachedSecret;
  const file = join(dirname(process.env.DATABASE_PATH || "./data/tome.db"), ".auth-secret");
  try {
    cachedSecret = readFileSync(file, "utf8").trim() || undefined;
  } catch {
    /* made below */
  }
  if (!cachedSecret) {
    cachedSecret = randomBytes(32).toString("base64url");
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, cachedSecret, { mode: 0o600 });
    } catch {
      // Kept in memory only: sign-ins last until Tome restarts. Setting AUTH_SECRET avoids this.
    }
  }
  return cachedSecret;
}

/** Forgets the cached secret, for tests. */
export function resetAuthSecretCache(): void {
  cachedSecret = undefined;
}

function sessionKey(): Buffer {
  return createHmac("sha256", getAuthSecret()).update(`tome-session-v1\0${getAuthPassword()}`).digest();
}

function sign(expires: string): string {
  return createHmac("sha256", sessionKey()).update(expires).digest("base64url");
}

/** A new session cookie value, good for SESSION_DAYS. */
export function createSessionToken(now = Date.now()): string {
  const expires = String(Math.floor(now / 1000) + SESSION_DAYS * 86400);
  return `v1.${expires}.${sign(expires)}`;
}

/** Whether a session cookie value was made here, for the current password, and hasn't expired. */
export function verifySessionToken(token: string | null | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^\d{1,12}$/.test(parts[1]!)) return false;
  if (Number(parts[1]) * 1000 <= now) return false;
  return safeEqual(parts[2]!, sign(parts[1]!));
}

export async function isAuthenticated(): Promise<boolean> {
  if (!isAuthEnabled()) {
    return true; // Auth disabled, always authenticated
  }
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(AUTH_COOKIE_NAME)?.value);
}

export function isAuthenticatedFromRequest(request: NextRequest): boolean {
  if (!isAuthEnabled()) {
    return true; // Auth disabled, always authenticated
  }
  return verifySessionToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);
}

function isSecureConnection(request: NextRequest): boolean {
  // Check x-forwarded-proto header (for reverse proxies/load balancers)
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto === "https";
  }

  // Fall back to checking the URL protocol
  return request.url.startsWith("https://");
}

export function createAuthResponse(request: NextRequest): NextResponse {
  const response = NextResponse.json({ success: true });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: createSessionToken(),
    httpOnly: true,
    secure: isSecureConnection(request),
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
    path: "/",
  });

  return response;
}

// --- Sign-in attempts ---

/** Failed sign-ins allowed from one client before it has to wait. */
export const LOGIN_ATTEMPTS = 5;
/** How long it waits, in seconds. */
export const LOGIN_LOCKOUT_SECONDS = 60;

const failures = new Map<string, { count: number; until: number }>();

/** The client a request came from, as the reverse proxy reports it. */
export function clientKey(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

/** Seconds a client must wait before trying again; 0 when it may try now. */
export function loginWait(key: string, now = Date.now()): number {
  const f = failures.get(key);
  return f && f.until > now ? Math.ceil((f.until - now) / 1000) : 0;
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const count = (failures.get(key)?.count ?? 0) + 1;
  failures.set(key, { count, until: count >= LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_SECONDS * 1000 : 0 });
  // Keep the map small: forget clients that stopped long ago.
  if (failures.size > 1000) {
    for (const [k, v] of failures) if (v.until < now) failures.delete(k);
  }
}

export function clearLoginFailures(key: string): void {
  failures.delete(key);
}

/** Forgets every failed attempt, for tests. */
export function resetLoginFailures(): void {
  failures.clear();
}

// --- The proxy's check ---

/** What an API token may do. */
export type TokenAccess = "read" | "write";

/** Looks an API token up: its access, or null when no such token exists. */
export type TokenVerifier = (token: string) => Promise<TokenAccess | null>;

/** API routes anyone may call: signing in and out, and whether auth is on. */
const PUBLIC_API = ["/api/auth/login", "/api/auth/logout", "/api/auth/status"];
/** Routes only a signed-in person may call, never a token: making and revoking tokens. */
const SESSION_ONLY_API = ["/api/tokens"];
const READ_METHODS = ["GET", "HEAD", "OPTIONS"];

const unauthorized = (message: string, status = 401) => NextResponse.json({ error: message }, { status });

/**
 * Whether a request may go on: null when it may, otherwise the response to send. Pages need a signed-in session and
 * go to /login without one. API routes need a session or an API token, except signing in and OPDS, which checks its
 * own HTTP Basic auth. A read token can only read, and no token can manage tokens.
 */
export async function proxyAuthCheck(request: NextRequest, verifyToken?: TokenVerifier): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;

  // If auth is disabled, redirect /login to home
  if (!isAuthEnabled()) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return null;
  }

  if (pathname === "/login") return null;

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API.some((p) => pathname === p) || pathname === "/api/opds" || pathname.startsWith("/api/opds/")) {
      return null;
    }
    if (isAuthenticatedFromRequest(request)) return null;

    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization")?.trim() ?? "")?.[1];
    if (!bearer) return unauthorized("Sign in, or send an API token as Authorization: Bearer <token>.");
    const access = verifyToken ? await verifyToken(bearer) : null;
    if (!access) return unauthorized("That API token isn't valid. Make a new one under Settings → API tokens.");
    if (SESSION_ONLY_API.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return unauthorized("API tokens can't manage tokens. Sign in to Tome to do that.", 403);
    }
    if (access === "read" && !READ_METHODS.includes(request.method)) {
      return unauthorized("This API token can only read. Make one with write access to change anything.", 403);
    }
    return null;
  }

  if (!isAuthenticatedFromRequest(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return null;
}
