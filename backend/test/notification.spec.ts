import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getUsersToNotifyForRelease,
  markUserReleaseNotified,
} from '../src/db/releaseQueries';
import { generateId } from '../src/db/utils';
import { clearAllTables } from './setup';

// テスト用のデータをセットアップ
async function setupTestData(db: D1Database) {
  // ユーザーを作成
  const userId1 = generateId();
  const userId2 = generateId();
  const userId3 = generateId();

  await db.batch([
    db.prepare(
      'INSERT INTO users (id, email, name, email_verified) VALUES (?, ?, ?, 1)'
    ).bind(userId1, 'user1@example.com', 'User One'),
    db.prepare(
      'INSERT INTO users (id, email, name, email_verified) VALUES (?, ?, ?, 1)'
    ).bind(userId2, 'user2@example.com', 'User Two'),
    db.prepare(
      'INSERT INTO users (id, email, name, email_verified) VALUES (?, ?, ?, 1)'
    ).bind(userId3, 'user3@example.com', null),
  ]);

  // ウォッチリストを作成
  const watchlistId1 = generateId();
  const watchlistId2 = generateId();
  const watchlistId3 = generateId();

  await db.batch([
    db.prepare(
      'INSERT INTO watchlist (id, user_id, stock_code, stock_name) VALUES (?, ?, ?, ?)'
    ).bind(watchlistId1, userId1, '7203', 'トヨタ自動車'),
    db.prepare(
      'INSERT INTO watchlist (id, user_id, stock_code, stock_name) VALUES (?, ?, ?, ?)'
    ).bind(watchlistId2, userId2, '7203', 'トヨタ'),
    db.prepare(
      'INSERT INTO watchlist (id, user_id, stock_code, stock_name) VALUES (?, ?, ?, ?)'
    ).bind(watchlistId3, userId3, '6758', 'ソニー'),
  ]);

  // EarningsRelease を作成
  const releaseId = generateId();
  await db.prepare(
    'INSERT INTO earnings_release (id, release_type, stock_code, fiscal_year, fiscal_quarter) VALUES (?, ?, ?, ?, ?)'
  ).bind(releaseId, 'quarterly_earnings', '7203', '2025', 2).run();

  // user_release_analysis を作成（user1, user2 のみ）
  const analysisId1 = generateId();
  const analysisId2 = generateId();

  await db.batch([
    db.prepare(
      'INSERT INTO user_release_analysis (id, user_id, release_id, custom_analysis) VALUES (?, ?, ?, ?)'
    ).bind(analysisId1, userId1, releaseId, '{"overview": "test"}'),
    db.prepare(
      'INSERT INTO user_release_analysis (id, user_id, release_id, custom_analysis, notified_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
    ).bind(analysisId2, userId2, releaseId, '{"overview": "test2"}'),
  ]);

  return {
    users: [
      { id: userId1, email: 'user1@example.com', name: 'User One' },
      { id: userId2, email: 'user2@example.com', name: 'User Two' },
      { id: userId3, email: 'user3@example.com', name: null },
    ],
    releaseId,
    analysisIds: [analysisId1, analysisId2],
  };
}

describe('通知処理', () => {
  beforeEach(async () => {
    await clearAllTables(env.DB);
  });

  describe('getUsersToNotifyForRelease', () => {
    it('notified_at が NULL のユーザーのみを取得する', async () => {
      const { releaseId } = await setupTestData(env.DB);

      const users = await getUsersToNotifyForRelease(env.DB, '7203', releaseId);

      // user1 のみが対象（user2 は notified_at が設定済み）
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('user1@example.com');
      expect(users[0].name).toBe('User One');
      expect(users[0].stock_name).toBe('トヨタ自動車');
    });

    it('その銘柄をウォッチしていないユーザーは含まれない', async () => {
      const { releaseId } = await setupTestData(env.DB);

      // user3 は 6758（ソニー）をウォッチしているが、7203（トヨタ）はウォッチしていない
      const users = await getUsersToNotifyForRelease(env.DB, '7203', releaseId);

      const emails = users.map(u => u.email);
      expect(emails).not.toContain('user3@example.com');
    });

    it('該当するユーザーがいない場合は空配列を返す', async () => {
      await setupTestData(env.DB);
      const nonExistentReleaseId = generateId();

      const users = await getUsersToNotifyForRelease(env.DB, '7203', nonExistentReleaseId);

      expect(users).toHaveLength(0);
    });

    it('全員が通知済みの場合は空配列を返す', async () => {
      const { releaseId, analysisIds } = await setupTestData(env.DB);

      // user1 も通知済みにする
      await markUserReleaseNotified(env.DB, analysisIds[0]);

      const users = await getUsersToNotifyForRelease(env.DB, '7203', releaseId);

      expect(users).toHaveLength(0);
    });
  });

  describe('markUserReleaseNotified', () => {
    it('notified_at を現在時刻に更新する', async () => {
      const { analysisIds } = await setupTestData(env.DB);
      const analysisId = analysisIds[0];

      // 更新前は notified_at が NULL
      const before = await env.DB.prepare(
        'SELECT notified_at FROM user_release_analysis WHERE id = ?'
      ).bind(analysisId).first<{ notified_at: string | null }>();
      expect(before?.notified_at).toBeNull();

      // 通知完了をマーク
      await markUserReleaseNotified(env.DB, analysisId);

      // 更新後は notified_at が設定されている
      const after = await env.DB.prepare(
        'SELECT notified_at FROM user_release_analysis WHERE id = ?'
      ).bind(analysisId).first<{ notified_at: string | null }>();
      expect(after?.notified_at).not.toBeNull();
    });

    it('存在しない analysis_id でもエラーにならない', async () => {
      const nonExistentId = generateId();

      // エラーにならずに完了する
      await expect(markUserReleaseNotified(env.DB, nonExistentId)).resolves.toBeUndefined();
    });
  });
});
