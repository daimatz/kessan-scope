-- document_url を document_urls (JSON配列) に変更

CREATE TABLE earnings_new (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  fiscal_quarter INTEGER NOT NULL,
  announcement_date TEXT NOT NULL,
  content_hash TEXT UNIQUE,
  r2_key TEXT,
  document_urls TEXT,  -- JSON配列 ["url1", "url2", ...]
  document_title TEXT,
  raw_data TEXT,
  summary TEXT,
  highlights TEXT,
  lowlights TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 既存データを移行（単一URLをJSON配列に変換）
INSERT INTO earnings_new
SELECT
  id, stock_code, fiscal_year, fiscal_quarter, announcement_date,
  content_hash, r2_key,
  CASE WHEN document_url IS NOT NULL THEN '["' || document_url || '"]' ELSE NULL END,
  document_title, raw_data, summary, highlights, lowlights, created_at
FROM earnings;

DROP TABLE earnings;
ALTER TABLE earnings_new RENAME TO earnings;

CREATE INDEX idx_earnings_stock_code ON earnings(stock_code);
CREATE INDEX idx_earnings_date ON earnings(announcement_date);
CREATE INDEX idx_earnings_content_hash ON earnings(content_hash);
