// テスト用ヘルパー

export async function clearAllTables(db: D1Database): Promise<void> {
  const tables = [
    'release_analysis_history',
    'user_release_analysis',
    'earnings',
    'earnings_release',
    'watchlist',
    'users',
  ];

  for (const table of tables) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
}
