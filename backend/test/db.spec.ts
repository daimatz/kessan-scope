import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('DB接続テスト', () => {
  it('select 1 が動く', async () => {
    const result = await env.DB.prepare('SELECT 1 as n').first<{ n: number }>();
    expect(result?.n).toBe(1);
  });

  it('users テーブルが存在する', async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).first<{ name: string }>();
    expect(result?.name).toBe('users');
  });
});
