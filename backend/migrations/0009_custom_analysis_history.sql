-- カスタム分析の履歴を保存するテーブル
-- プロンプト変更時の再分析で過去の結果を保持

CREATE TABLE custom_analysis_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earnings_id TEXT NOT NULL REFERENCES earnings(id) ON DELETE CASCADE,
  custom_prompt TEXT NOT NULL,
  analysis TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ユーザー×決算ごとの履歴検索用インデックス
CREATE INDEX idx_custom_analysis_history_user_earnings
  ON custom_analysis_history(user_id, earnings_id);

-- 作成日時でのソート用
CREATE INDEX idx_custom_analysis_history_created
  ON custom_analysis_history(created_at DESC);
