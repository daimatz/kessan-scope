-- 決算発表セット化: EarningsRelease テーブル追加
-- 決算短信 + 決算プレゼン を1つの「決算発表」として扱う

-- 1. EarningsRelease テーブル作成
CREATE TABLE IF NOT EXISTS earnings_release (
  id TEXT PRIMARY KEY,
  release_type TEXT NOT NULL,  -- 'quarterly_earnings' | 'growth_potential'
  stock_code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  fiscal_quarter INTEGER,      -- NULL for growth_potential
  summary TEXT,                -- LLM分析結果（JSON）
  highlights TEXT,             -- JSON配列
  lowlights TEXT,              -- JSON配列
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ユニーク制約（stock_code + fiscal_year + fiscal_quarter + release_type）
CREATE UNIQUE INDEX IF NOT EXISTS idx_earnings_release_unique
ON earnings_release(stock_code, fiscal_year, fiscal_quarter, release_type);

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_earnings_release_stock_code ON earnings_release(stock_code);
CREATE INDEX IF NOT EXISTS idx_earnings_release_fiscal ON earnings_release(stock_code, fiscal_year, fiscal_quarter);

-- 2. Earnings テーブル拡張
ALTER TABLE earnings ADD COLUMN release_id TEXT REFERENCES earnings_release(id);
ALTER TABLE earnings ADD COLUMN document_type TEXT;  -- 'earnings_summary' | 'earnings_presentation' | 'growth_potential'

CREATE INDEX IF NOT EXISTS idx_earnings_release_id ON earnings(release_id);

-- 3. 関連テーブルに release_id カラム追加（既存の earnings_id は後方互換のため残す）
ALTER TABLE user_earnings_analysis ADD COLUMN release_id TEXT REFERENCES earnings_release(id);
ALTER TABLE chat_messages ADD COLUMN release_id TEXT REFERENCES earnings_release(id);
ALTER TABLE custom_analysis_history ADD COLUMN release_id TEXT REFERENCES earnings_release(id);

CREATE INDEX IF NOT EXISTS idx_user_earnings_analysis_release_id ON user_earnings_analysis(release_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_release_id ON chat_messages(release_id);
CREATE INDEX IF NOT EXISTS idx_custom_analysis_history_release_id ON custom_analysis_history(release_id);

-- 4. 既存データのマイグレーション
-- 既存の earnings レコードごとに EarningsRelease を作成し、紐づける
-- （実行時に処理するため、ここでは空のまま。アプリケーション側で処理）
