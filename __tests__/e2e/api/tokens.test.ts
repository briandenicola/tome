import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestDatabase, teardownTestDatabase, clearTestDatabase } from "../../helpers/db-setup";
import { apiTokenRepository } from "@/lib/repositories/api-token.repository";
import { apiTokenService } from "@/lib/services/api-token.service";
import { GET, POST } from "@/app/api/tokens/route";
import { DELETE } from "@/app/api/tokens/[id]/route";
import { POST as LOGIN } from "@/app/api/auth/login/route";
import { resetLoginFailures } from "@/lib/auth";

/**
 * API tokens: made from the settings page, shown once, kept hashed, checked by the proxy (see unit/lib/auth.test.ts
 * for what each kind may do). And the login route's limit on wrong passwords.
 */

beforeAll(async () => {
  await setupTestDatabase(__filename);
});

afterAll(async () => {
  await teardownTestDatabase(__filename);
});

beforeEach(async () => {
  await clearTestDatabase(__filename);
});

const json = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

describe('API tokens', () => {
  test('a token is shown once, kept only as a hash, and checks out with its access', async () => {
    const res = await POST(json('POST', 'http://localhost/api/tokens', { name: 'Life store', access: 'read' }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.token).toMatch(/^tome_[A-Za-z0-9_-]{32}$/);
    expect(data.apiToken).toMatchObject({ name: 'Life store', access: 'read', hint: data.token.slice(-4), lastUsedAt: null });
    expect(data.apiToken).not.toHaveProperty('tokenHash');

    const stored = await apiTokenRepository.findById(data.apiToken.id);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(data.token);

    expect(await apiTokenService.verify(data.token)).toBe('read');
    expect((await apiTokenRepository.findById(data.apiToken.id))?.lastUsedAt).toBeInstanceOf(Date);
    expect(await apiTokenService.verify(`${data.token}x`)).toBeNull();
    expect(await apiTokenService.verify('not-a-tome-token')).toBeNull();
  });

  test('the list shows names, access and hints, newest first, never the token', async () => {
    const first = await apiTokenService.create('Hermes', 'write');
    const second = await apiTokenService.create('Life store', 'read');

    const res = await GET();
    const { data } = await res.json();
    expect(data.map((t: { name: string }) => t.name)).toEqual(['Life store', 'Hermes']);
    const body = JSON.stringify(data);
    expect(body).not.toContain(first.token);
    expect(body).not.toContain(second.token);
    expect(body).not.toContain('tokenHash');
  });

  test('a revoked token stops working at once', async () => {
    const { token, apiToken } = await apiTokenService.create('Script', 'write');
    expect(await apiTokenService.verify(token)).toBe('write');

    const res = await DELETE(json('DELETE', `http://localhost/api/tokens/${apiToken.id}`), {
      params: Promise.resolve({ id: String(apiToken.id) }),
    });
    expect(res.status).toBe(200);
    expect(await apiTokenService.verify(token)).toBeNull();

    const again = await DELETE(json('DELETE', `http://localhost/api/tokens/${apiToken.id}`), {
      params: Promise.resolve({ id: String(apiToken.id) }),
    });
    expect(again.status).toBe(404);
    const bad = await DELETE(json('DELETE', 'http://localhost/api/tokens/abc'), { params: Promise.resolve({ id: 'abc' }) });
    expect(bad.status).toBe(400);
  });

  test('a token needs a name and an access of read or write', async () => {
    for (const [body, message] of [
      [{ name: '  ', access: 'read' }, 'Give the token a name, like the app that will use it.'],
      [{ name: 'x'.repeat(101), access: 'read' }, 'Keep the name under 100 characters.'],
      [{ name: 'Admin', access: 'admin' }, 'Access is "read" or "write".'],
    ] as const) {
      const res = await POST(json('POST', 'http://localhost/api/tokens', body));
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toBe(message);
    }
    const notJson = await POST(new NextRequest('http://localhost/api/tokens', { method: 'POST', body: 'nope' }));
    expect(notJson.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, AUTH_PASSWORD: 'correct horse', AUTH_SECRET: 'test-secret' };
    resetLoginFailures();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const login = (password: string, ip = '203.0.113.7') =>
    LOGIN(json('POST', 'http://localhost/api/auth/login', { password }, { 'x-forwarded-for': ip }));

  test('the right password sets a signed session; a wrong one is refused', async () => {
    const ok = await login('correct horse');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toMatch(/tome-auth=v1\.\d+\./);

    const wrong = await login('correct hors');
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  test('after five wrong passwords, even the right one waits a minute', async () => {
    for (let i = 0; i < 5; i++) expect((await login('guess')).status).toBe(401);
    const blocked = await login('correct horse');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect((await blocked.json()).error).toBe('Too many wrong passwords. Try again in 60 seconds.');
    // Another client isn't held up.
    expect((await login('correct horse', '198.51.100.2')).status).toBe(200);
  });
});
