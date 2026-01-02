-- OpenAI連携を削除したため、openai_modelカラムを削除
-- SQLiteはALTER TABLE DROP COLUMNをサポートしていないため、テーブル再作成が必要

-- 一時テーブルにデータを退避
CREATE TABLE users_backup AS SELECT
  id, google_id, email, name, password_hash,
  email_verified, email_verification_token, email_verification_expires_at,
  created_at, updated_at
FROM users;

-- 元のテーブルを削除
DROP TABLE users;

-- 新しいテーブルを作成（openai_modelなし）
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  email_verified INTEGER DEFAULT 0,
  email_verification_token TEXT,
  email_verification_expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- データを復元
INSERT INTO users SELECT * FROM users_backup;

-- 一時テーブルを削除
DROP TABLE users_backup;
