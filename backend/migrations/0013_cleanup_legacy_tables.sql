-- レガシーテーブル・カラムのクリーンアップ
-- user_earnings_analysis → user_release_analysis に完全移行済み
-- custom_analysis_history → release_analysis_history に完全移行済み
-- chat_messages.earnings_id → release_id に完全移行済み

-- 1. 旧テーブル user_earnings_analysis を削除
DROP TABLE IF EXISTS user_earnings_analysis;

-- 2. 旧テーブル custom_analysis_history を削除
DROP TABLE IF EXISTS custom_analysis_history;

-- 3. chat_messages テーブルから earnings_id カラムを削除
-- SQLite は ALTER TABLE DROP COLUMN をサポートしないため、テーブル再作成が必要

-- 3.1 新しいテーブルを作成
CREATE TABLE chat_messages_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES earnings_release(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.2 release_id が設定されているデータのみ移行（release_id が NULL のデータは孤立データとして削除）
INSERT INTO chat_messages_new (id, user_id, release_id, role, content, created_at)
SELECT id, user_id, release_id, role, content, created_at
FROM chat_messages
WHERE release_id IS NOT NULL;

-- 3.3 旧テーブルを削除
DROP TABLE chat_messages;

-- 3.4 新テーブルをリネーム
ALTER TABLE chat_messages_new RENAME TO chat_messages;

-- 3.5 インデックスを再作成
CREATE INDEX idx_chat_messages_user_release ON chat_messages(user_id, release_id);
CREATE INDEX idx_chat_messages_release_id ON chat_messages(release_id);
