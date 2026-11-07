import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Authentication Module Tests
 *
 * Tests the auth module which provides:
 * - Signed session cookies (unforgeable; a password change signs everyone out)
 * - Auth enabled/disabled state
 * - Secure connection detection
 * - The proxy's check: pages, the API (sessions and API tokens), OPDS left to its own auth
 * - Limits on wrong passwords
 */

// Store original env
const originalEnv = process.env;

// Mock the cookies function from next/headers
const mockCookiesGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    get: mockCookiesGet,
  }),
}));

/** A request carrying the session cookie (NextRequest doesn't read a Cookie header given to its constructor in tests). */
function withCookie(url: string, value: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  const request = new NextRequest(url, init);
  request.cookies.set('tome-auth', value);
  return request;
}

describe('Auth Module', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCookiesGet.mockReset();
    process.env = { ...originalEnv, AUTH_SECRET: 'test-secret-for-signing-sessions' };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ============================================================================
  // Session tokens
  // ============================================================================

  describe('session tokens', () => {
    test('a fresh token verifies; a tampered, expired or foreign one does not', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { createSessionToken, verifySessionToken, SESSION_DAYS } = await import('@/lib/auth');
      const now = Date.parse('2026-11-07T12:00:00Z');
      const token = createSessionToken(now);

      expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]+$/);
      expect(verifySessionToken(token, now)).toBe(true);

      const [v, expires, sig] = token.split('.');
      expect(verifySessionToken(`${v}.${Number(expires) + 86400}.${sig}`, now)).toBe(false); // a longer life, same signature
      expect(verifySessionToken(`${v}.${expires}.${sig!.slice(0, -1)}A`, now)).toBe(false);
      expect(verifySessionToken(token, now + SESSION_DAYS * 86400 * 1000)).toBe(false); // expired
      expect(verifySessionToken('authenticated', now)).toBe(false);
      expect(verifySessionToken('', now)).toBe(false);
      expect(verifySessionToken(undefined, now)).toBe(false);
    });

    test('changing the password signs everyone out', async () => {
      process.env.AUTH_PASSWORD = 'old-password';
      const auth = await import('@/lib/auth');
      const token = auth.createSessionToken();
      process.env.AUTH_PASSWORD = 'new-password';
      expect(auth.verifySessionToken(token)).toBe(false);
    });

    test('a token signed with another secret is refused', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const auth = await import('@/lib/auth');
      const token = auth.createSessionToken();
      process.env.AUTH_SECRET = 'a-different-secret';
      expect(auth.verifySessionToken(token)).toBe(false);
    });

    test('without AUTH_SECRET, a random secret is made once and kept next to the database', async () => {
      delete process.env.AUTH_SECRET;
      const dir = mkdtempSync(join(tmpdir(), 'tome-auth-'));
      process.env.DATABASE_PATH = join(dir, 'tome.db');
      process.env.AUTH_PASSWORD = 'testpassword';
      const auth = await import('@/lib/auth');
      const secret = auth.getAuthSecret();
      expect(secret.length).toBeGreaterThanOrEqual(32);
      expect(readFileSync(join(dir, '.auth-secret'), 'utf8')).toBe(secret);
      const token = auth.createSessionToken();

      // A restart reads the same secret, so sign-ins survive it.
      auth.resetAuthSecretCache();
      expect(auth.getAuthSecret()).toBe(secret);
      expect(auth.verifySessionToken(token)).toBe(true);
    });

    test('passwords are compared in full', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { checkPassword, safeEqual } = await import('@/lib/auth');
      expect(checkPassword('testpassword')).toBe(true);
      expect(checkPassword('testpasswor')).toBe(false);
      expect(checkPassword('testpassword ')).toBe(false);
      expect(safeEqual('abc', 'abc')).toBe(true);
      expect(safeEqual('abc', 'abd')).toBe(false);
    });
  });

  // ============================================================================
  // isAuthenticated (async version using cookies())
  // ============================================================================

  describe('isAuthenticated()', () => {
    test('should return true when auth is disabled', async () => {
      delete process.env.AUTH_PASSWORD;
      const { isAuthenticated } = await import('@/lib/auth');
      const result = await isAuthenticated();
      expect(result).toBe(true);
    });

    test('should return true with a signed session cookie when auth is enabled', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { isAuthenticated, createSessionToken } = await import('@/lib/auth');
      mockCookiesGet.mockReturnValue({ value: createSessionToken() });

      expect(await isAuthenticated()).toBe(true);
    });

    test('the old fixed cookie value no longer signs anyone in', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      mockCookiesGet.mockReturnValue({ value: 'authenticated' });

      const { isAuthenticated } = await import('@/lib/auth');
      expect(await isAuthenticated()).toBe(false);
    });

    test('should return false with invalid cookie value when auth is enabled', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      mockCookiesGet.mockReturnValue({ value: 'wrong-value' });

      const { isAuthenticated } = await import('@/lib/auth');
      const result = await isAuthenticated();
      expect(result).toBe(false);
    });

    test('should return false with missing cookie when auth is enabled', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      mockCookiesGet.mockReturnValue(undefined);

      const { isAuthenticated } = await import('@/lib/auth');
      const result = await isAuthenticated();
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // isAuthenticatedFromRequest
  // ============================================================================

  describe('isAuthenticatedFromRequest()', () => {
    test('should return true when auth is disabled', async () => {
      delete process.env.AUTH_PASSWORD;
      const { isAuthenticatedFromRequest } = await import('@/lib/auth');

      const request = new NextRequest('http://localhost/test');
      const result = isAuthenticatedFromRequest(request);
      expect(result).toBe(true);
    });

    test('should return true with a signed session cookie when auth is enabled', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { isAuthenticatedFromRequest, createSessionToken } = await import('@/lib/auth');

      expect(isAuthenticatedFromRequest(withCookie('http://localhost/test', createSessionToken()))).toBe(true);
    });

    test('the old fixed cookie value no longer signs anyone in', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { isAuthenticatedFromRequest } = await import('@/lib/auth');

      expect(isAuthenticatedFromRequest(withCookie('http://localhost/test', 'authenticated'))).toBe(false);
    });

    test('should return false with invalid cookie value when auth is enabled', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { isAuthenticatedFromRequest } = await import('@/lib/auth');

      const request = new NextRequest('http://localhost/test', {
        headers: { cookie: 'tome-auth=invalid' },
      });
      const result = isAuthenticatedFromRequest(request);
      expect(result).toBe(false);
    });

    test('should return false with missing cookie when auth is enabled', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { isAuthenticatedFromRequest } = await import('@/lib/auth');

      const request = new NextRequest('http://localhost/test');
      const result = isAuthenticatedFromRequest(request);
      expect(result).toBe(false);
    });
  });

  // ============================================================================
  // createAuthResponse
  // ============================================================================

  describe('createAuthResponse()', () => {
    test('should set a signed session cookie for HTTPS request', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { createAuthResponse, verifySessionToken } = await import('@/lib/auth');

      const request = new NextRequest('https://localhost/login');
      const response = createAuthResponse(request);

      expect(response.status).toBe(200);
      const setCookie = response.headers.get('set-cookie');
      const value = /tome-auth=([^;]+)/.exec(setCookie ?? '')?.[1];
      expect(value).toMatch(/^v1\./);
      expect(verifySessionToken(value)).toBe(true);
      expect(setCookie).not.toContain('tome-auth=authenticated');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      // SameSite can be Lax or lax depending on implementation
      expect(setCookie?.toLowerCase()).toContain('samesite=lax');
    });

    test('should create response with auth cookie for HTTP request (no secure flag)', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { createAuthResponse } = await import('@/lib/auth');

      const request = new NextRequest('http://localhost/login');
      const response = createAuthResponse(request);

      expect(response.status).toBe(200);
      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toContain('tome-auth=v1.');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).not.toContain('Secure');
    });

    test('should respect x-forwarded-proto header for secure detection', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { createAuthResponse } = await import('@/lib/auth');

      // HTTP URL but with x-forwarded-proto: https (behind proxy)
      const request = new NextRequest('http://localhost/login', {
        headers: { 'x-forwarded-proto': 'https' },
      });
      const response = createAuthResponse(request);

      expect(response.status).toBe(200);
      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toContain('Secure');
    });
  });

  // ============================================================================
  // proxyAuthCheck
  // ============================================================================

  describe('proxyAuthCheck()', () => {
    test('should redirect /login to home when auth is disabled', async () => {
      delete process.env.AUTH_PASSWORD;
      const { proxyAuthCheck } = await import('@/lib/auth');

      const request = new NextRequest('http://localhost/login');
      const result = await proxyAuthCheck(request);

      expect(result).toBeInstanceOf(NextResponse);
      expect(result?.status).toBe(307); // Redirect
      expect(result?.headers.get('location')).toContain('/');
    });

    test('should let everything through when auth is disabled', async () => {
      delete process.env.AUTH_PASSWORD;
      const { proxyAuthCheck } = await import('@/lib/auth');

      expect(await proxyAuthCheck(new NextRequest('http://localhost/books'))).toBeNull();
      expect(await proxyAuthCheck(new NextRequest('http://localhost/api/books', { method: 'POST' }))).toBeNull();
    });

    test('should allow login page access when auth is enabled', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { proxyAuthCheck } = await import('@/lib/auth');

      const request = new NextRequest('http://localhost/login');
      const result = await proxyAuthCheck(request);

      expect(result).toBeNull();
    });

    test('should redirect to login for unauthenticated request', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { proxyAuthCheck } = await import('@/lib/auth');

      const request = new NextRequest('http://localhost/books');
      const result = await proxyAuthCheck(request);

      expect(result).toBeInstanceOf(NextResponse);
      expect(result?.status).toBe(307); // Redirect
      expect(result?.headers.get('location')).toContain('/login');
    });

    test('should allow a page with a signed session cookie', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { proxyAuthCheck, createSessionToken } = await import('@/lib/auth');

      expect(await proxyAuthCheck(withCookie('http://localhost/books', createSessionToken()))).toBeNull();
    });

    test('should redirect if auth cookie value is wrong, or the old fixed value', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { proxyAuthCheck } = await import('@/lib/auth');

      for (const value of ['wrong-value', 'authenticated']) {
        const result = await proxyAuthCheck(withCookie('http://localhost/books', value));
        expect(result?.status).toBe(307);
        expect(result?.headers.get('location')).toContain('/login');
      }
    });

    describe('the API', () => {
      const tokens: Record<string, 'read' | 'write'> = { 'tome_reader': 'read', 'tome_writer': 'write' };
      const verify = async (token: string) => tokens[token] ?? null;

      beforeEach(() => {
        process.env.AUTH_PASSWORD = 'testpassword';
      });

      test('turns away a request with neither a session nor a token', async () => {
        const { proxyAuthCheck } = await import('@/lib/auth');

        for (const [path, method] of [['/api/books', 'GET'], ['/api/books/1/status', 'POST'], ['/api/stats/overview', 'GET']]) {
          const result = await proxyAuthCheck(new NextRequest(`http://localhost${path}`, { method }), verify);
          expect(result?.status).toBe(401);
          expect(await result?.json()).toEqual({ error: 'Sign in, or send an API token as Authorization: Bearer <token>.' });
        }
      });

      test('turns away the old fixed cookie value', async () => {
        const { proxyAuthCheck } = await import('@/lib/auth');

        const result = await proxyAuthCheck(withCookie('http://localhost/api/books', 'authenticated'), verify);
        expect(result?.status).toBe(401);
      });

      test('lets signing in, signing out and the auth status through', async () => {
        const { proxyAuthCheck } = await import('@/lib/auth');

        for (const path of ['/api/auth/login', '/api/auth/logout', '/api/auth/status']) {
          expect(await proxyAuthCheck(new NextRequest(`http://localhost${path}`, { method: 'POST' }), verify)).toBeNull();
        }
      });

      test('leaves OPDS to its own Basic auth', async () => {
        const { proxyAuthCheck } = await import('@/lib/auth');

        expect(await proxyAuthCheck(new NextRequest('http://localhost/api/opds'), verify)).toBeNull();
        expect(await proxyAuthCheck(new NextRequest('http://localhost/api/opds/books'), verify)).toBeNull();
        // A path that only starts the same way is not OPDS.
        expect((await proxyAuthCheck(new NextRequest('http://localhost/api/opdsx'), verify))?.status).toBe(401);
      });

      test('lets a signed-in person do anything', async () => {
        const { proxyAuthCheck, createSessionToken } = await import('@/lib/auth');

        const request = withCookie('http://localhost/api/books/1/status', createSessionToken(), { method: 'POST' });
        expect(await proxyAuthCheck(request, verify)).toBeNull();
        expect(await proxyAuthCheck(withCookie('http://localhost/api/tokens', createSessionToken(), { method: 'POST' }), verify)).toBeNull();
      });

      test('a read token can read and nothing else', async () => {
        const { proxyAuthCheck } = await import('@/lib/auth');
        const req = (method: string) =>
          new NextRequest('http://localhost/api/books', { method, headers: { authorization: 'Bearer tome_reader' } });

        expect(await proxyAuthCheck(req('GET'), verify)).toBeNull();
        expect(await proxyAuthCheck(req('HEAD'), verify)).toBeNull();
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const result = await proxyAuthCheck(req(method), verify);
          expect(result?.status).toBe(403);
          expect((await result?.json()).error).toMatch(/can only read/);
        }
      });

      test('a write token can change things', async () => {
        const { proxyAuthCheck } = await import('@/lib/auth');

        const request = new NextRequest('http://localhost/api/books/1/status', {
          method: 'POST',
          headers: { authorization: 'Bearer tome_writer' },
        });
        expect(await proxyAuthCheck(request, verify)).toBeNull();
      });

      test('an unknown token, or no way to check tokens, is turned away', async () => {
        const { proxyAuthCheck } = await import('@/lib/auth');

        const request = () => new NextRequest('http://localhost/api/books', { headers: { authorization: 'Bearer tome_nope' } });
        const unknown = await proxyAuthCheck(request(), verify);
        expect(unknown?.status).toBe(401);
        expect((await unknown?.json()).error).toMatch(/isn't valid/);
        expect((await proxyAuthCheck(request()))?.status).toBe(401);
      });

      test('no token can manage tokens, not even a write token', async () => {
        const { proxyAuthCheck } = await import('@/lib/auth');

        for (const path of ['/api/tokens', '/api/tokens/3']) {
          const result = await proxyAuthCheck(
            new NextRequest(`http://localhost${path}`, { method: 'GET', headers: { authorization: 'Bearer tome_writer' } }),
            verify
          );
          expect(result?.status).toBe(403);
        }
      });
    });
  });

  // ============================================================================
  // Sign-in attempts
  // ============================================================================

  describe('sign-in attempts', () => {
    test('a client waits after five wrong passwords, and a right one clears its count', async () => {
      const { loginWait, recordLoginFailure, clearLoginFailures, LOGIN_ATTEMPTS, LOGIN_LOCKOUT_SECONDS } = await import('@/lib/auth');
      const now = Date.parse('2026-11-07T12:00:00Z');

      for (let i = 1; i < LOGIN_ATTEMPTS; i++) recordLoginFailure('1.2.3.4', now);
      expect(loginWait('1.2.3.4', now)).toBe(0);
      recordLoginFailure('1.2.3.4', now);
      expect(loginWait('1.2.3.4', now)).toBe(LOGIN_LOCKOUT_SECONDS);
      expect(loginWait('5.6.7.8', now)).toBe(0); // others aren't held up
      expect(loginWait('1.2.3.4', now + LOGIN_LOCKOUT_SECONDS * 1000)).toBe(0);

      clearLoginFailures('1.2.3.4');
      recordLoginFailure('1.2.3.4', now);
      expect(loginWait('1.2.3.4', now)).toBe(0);
    });

    test('the client is the first address the reverse proxy reports', async () => {
      const { clientKey } = await import('@/lib/auth');

      expect(clientKey(new NextRequest('http://localhost/', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }))).toBe('9.9.9.9');
      expect(clientKey(new NextRequest('http://localhost/', { headers: { 'x-real-ip': '8.8.8.8' } }))).toBe('8.8.8.8');
      expect(clientKey(new NextRequest('http://localhost/'))).toBe('unknown');
    });
  });

  // ============================================================================
  // isSecureConnection (tested indirectly through createAuthResponse)
  // ============================================================================

  describe('isSecureConnection (indirect tests)', () => {
    test('should detect HTTPS URL as secure', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { createAuthResponse } = await import('@/lib/auth');

      const request = new NextRequest('https://example.com/login');
      const response = createAuthResponse(request);

      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toContain('Secure');
    });

    test('should detect HTTP URL as not secure', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { createAuthResponse } = await import('@/lib/auth');

      const request = new NextRequest('http://example.com/login');
      const response = createAuthResponse(request);

      const setCookie = response.headers.get('set-cookie');
      // The cookie is still set, but Secure flag behavior depends on URL protocol
      expect(setCookie).toContain('tome-auth');
    });

    test('should respect x-forwarded-proto: https header', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { createAuthResponse } = await import('@/lib/auth');

      const request = new NextRequest('http://example.com/login', {
        headers: { 'x-forwarded-proto': 'https' },
      });
      const response = createAuthResponse(request);

      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toContain('Secure');
    });

    test('should not set Secure for x-forwarded-proto: http', async () => {
      process.env.AUTH_PASSWORD = 'testpassword';
      const { createAuthResponse } = await import('@/lib/auth');

      const request = new NextRequest('http://example.com/login', {
        headers: { 'x-forwarded-proto': 'http' },
      });
      const response = createAuthResponse(request);

      // With x-forwarded-proto: http on an http URL, Secure should not be set
      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).not.toContain('Secure');
    });
  });
});
