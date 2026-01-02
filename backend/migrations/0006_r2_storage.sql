-- PDFをR2に保存し、コンテンツハッシュで重複判定
-- edinet_doc_id → content_hash に変更、r2_key を追加

-- 一時テーブルにデータを退避
CREATE TABLE earnings_backup AS SELECT * FROM earnings;

-- 元のテーブルを削除
DROP TABLE earnings;

-- 新しいテーブルを作成
CREATE TABLE earnings (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  fiscal_quarter INTEGER NOT NULL,
  announcement_date TEXT NOT NULL,
  content_hash TEXT UNIQUE,       -- PDF の MD5 ハッシュ
  r2_key TEXT,                    -- R2 オブジェクトキー
  document_url TEXT,              -- 元の TDnet URL（参考用）
  document_title TEXT,            -- ドキュメントタイトル
  raw_data TEXT,
  summary TEXT,
  highlights TEXT,
  lowlights TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- データを復元（edinet_doc_id は content_hash にマッピング、新規カラムは NULL）
INSERT INTO earnings (id, stock_code, fiscal_year, fiscal_quarter, announcement_date, content_hash, raw_data, summary, highlights, lowlights, created_at)
SELECT id, stock_code, fiscal_year, fiscal_quarter, announcement_date, edinet_doc_id, raw_data, summary, highlights, lowlights, created_at
FROM earnings_backup;

-- インデックスを再作成
CREATE INDEX idx_earnings_stock_code ON earnings(stock_code);
CREATE INDEX idx_earnings_date ON earnings(announcement_date);
CREATE INDEX idx_earnings_content_hash ON earnings(content_hash);

-- 一時テーブルを削除
DROP TABLE earnings_backup;
