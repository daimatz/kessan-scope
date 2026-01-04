-- パスワード認証を廃止したため、関連カラムを削除
-- SQLiteはALTER TABLE DROP COLUMNをサポートしていないため、テーブル再作成が必要

-- 一時テーブルにデータを退避
CREATE TABLE users_backup AS SELECT
  id, google_id, email, name, email_verified,
  created_at, updated_at
FROM users;

-- 元のテーブルを削除
DROP TABLE users;

-- 新しいテーブルを作成（password_hash, email_verification_token, email_verification_expires_at なし）
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  email_verified INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- データを復元
INSERT INTO users SELECT * FROM users_backup;

-- 一時テーブルを削除
DROP TABLE users_backup;

-- 不要なインデックスを削除（存在する場合）
DROP INDEX IF EXISTS idx_users_email_verification_token;
