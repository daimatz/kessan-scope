-- リリースベースのユーザー分析テーブル（user_earnings_analysis と別に管理）
-- user_earnings_analysis は earnings_id が NOT NULL なので、release 用に新テーブル作成

CREATE TABLE IF NOT EXISTS user_release_analysis (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES earnings_release(id) ON DELETE CASCADE,
  custom_analysis TEXT,
  custom_prompt_used TEXT,
  notified_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, release_id)
);

CREATE INDEX IF NOT EXISTS idx_user_release_analysis_user_id ON user_release_analysis(user_id);
CREATE INDEX IF NOT EXISTS idx_user_release_analysis_release_id ON user_release_analysis(release_id);

-- リリースベースのカスタム分析履歴テーブル
CREATE TABLE IF NOT EXISTS release_analysis_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  release_id TEXT NOT NULL REFERENCES earnings_release(id) ON DELETE CASCADE,
  custom_prompt TEXT NOT NULL,
  analysis TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_release_analysis_history_user_release ON release_analysis_history(user_id, release_id);
