-- URL インデックステーブル（高速な存在チェック用）
CREATE TABLE document_url_index (
  url TEXT PRIMARY KEY,
  earnings_id TEXT NOT NULL,
  FOREIGN KEY (earnings_id) REFERENCES earnings(id) ON DELETE CASCADE
);

-- 既存の document_urls から移行
INSERT OR IGNORE INTO document_url_index (url, earnings_id)
SELECT j.value, e.id
FROM earnings e, json_each(e.document_urls) j
WHERE e.document_urls IS NOT NULL;

-- earnings から document_urls カラムを削除
CREATE TABLE earnings_new (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  fiscal_quarter INTEGER NOT NULL,
  announcement_date TEXT NOT NULL,
  content_hash TEXT UNIQUE,
  r2_key TEXT,
  document_title TEXT,
  raw_data TEXT,
  summary TEXT,
  highlights TEXT,
  lowlights TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO earnings_new
SELECT id, stock_code, fiscal_year, fiscal_quarter, announcement_date,
       content_hash, r2_key, document_title, raw_data, summary, highlights, lowlights, created_at
FROM earnings;

DROP TABLE earnings;
ALTER TABLE earnings_new RENAME TO earnings;

CREATE INDEX idx_earnings_stock_code ON earnings(stock_code);
CREATE INDEX idx_earnings_date ON earnings(announcement_date);
CREATE INDEX idx_earnings_content_hash ON earnings(content_hash);
