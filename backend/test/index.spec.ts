import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('Kessan Scope API', () => {
  it('responds to health check', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('returns 401 for protected routes without auth', async () => {
    const response = await SELF.fetch('http://localhost/api/watchlist');
    expect(response.status).toBe(401);
  });

  it('returns user null for unauthenticated /api/auth/me', async () => {
    const response = await SELF.fetch('http://localhost/api/auth/me');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ user: null });
  });
});
