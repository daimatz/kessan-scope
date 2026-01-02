-- 同じ年度/四半期に複数のドキュメント（決算短信、説明資料等）を保存できるように
-- UNIQUE制約をedinet_doc_id（実際はTDnetドキュメントID）に変更

-- 一時テーブルにデータを退避
CREATE TABLE earnings_backup AS SELECT * FROM earnings;

-- 元のテーブルを削除
DROP TABLE earnings;

-- 新しいテーブルを作成（edinet_doc_idをUNIQUEに）
CREATE TABLE earnings (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  fiscal_quarter INTEGER NOT NULL,
  announcement_date TEXT NOT NULL,
  edinet_doc_id TEXT UNIQUE,
  raw_data TEXT,
  summary TEXT,
  highlights TEXT,
  lowlights TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- データを復元
INSERT INTO earnings SELECT * FROM earnings_backup;

-- インデックスを再作成
CREATE INDEX idx_earnings_stock_code ON earnings(stock_code);
CREATE INDEX idx_earnings_date ON earnings(announcement_date);

-- 一時テーブルを削除
DROP TABLE earnings_backup;
