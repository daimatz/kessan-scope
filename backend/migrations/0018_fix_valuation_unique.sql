-- UNIQUE制約を変更: record_dateを除外してfiscal_year, fiscal_quarterでマージ可能にする
-- SQLiteではALTER TABLEでUNIQUE制約を直接変更できないため、テーブルを再作成

-- 一時テーブルにデータをバックアップ
CREATE TABLE stock_valuation_backup AS SELECT * FROM stock_valuation;

-- 既存テーブルを削除
DROP TABLE stock_valuation;

-- 新しい制約でテーブルを再作成
CREATE TABLE stock_valuation (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  record_date DATE NOT NULL,
  fiscal_year TEXT,
  fiscal_quarter INTEGER,
  market_cap REAL,
  revenue REAL,
  operating_income REAL,
  net_income REAL,
  source TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(stock_code, fiscal_year, fiscal_quarter)
);

-- データを復元（重複がある場合は最新のrecord_dateを持つものを優先）
INSERT OR REPLACE INTO stock_valuation
SELECT * FROM stock_valuation_backup
WHERE id IN (
  SELECT id FROM stock_valuation_backup b1
  WHERE record_date = (
    SELECT MAX(record_date) FROM stock_valuation_backup b2
    WHERE b1.stock_code = b2.stock_code
    AND b1.fiscal_year = b2.fiscal_year
    AND COALESCE(b1.fiscal_quarter, 0) = COALESCE(b2.fiscal_quarter, 0)
  )
);

-- バックアップテーブルを削除
DROP TABLE stock_valuation_backup;

-- インデックスを再作成
CREATE INDEX IF NOT EXISTS idx_stock_valuation_stock_code ON stock_valuation(stock_code);
CREATE INDEX IF NOT EXISTS idx_stock_valuation_date ON stock_valuation(stock_code, record_date);
