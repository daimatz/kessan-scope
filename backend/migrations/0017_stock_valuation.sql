-- 時価総額・財務データの時系列保存テーブル
CREATE TABLE IF NOT EXISTS stock_valuation (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  record_date DATE NOT NULL,  -- データの基準日
  fiscal_year TEXT,           -- 会計年度 (nullable: 時価総額のみの場合)
  fiscal_quarter INTEGER,     -- 四半期 (nullable)
  market_cap REAL,            -- 時価総額（百万円）
  revenue REAL,               -- 売上高（百万円）
  operating_income REAL,      -- 営業利益（百万円）
  net_income REAL,            -- 純利益（百万円）
  source TEXT,                -- データソース (irbank, manual, etc.)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(stock_code, record_date, fiscal_year, fiscal_quarter)
);

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_stock_valuation_stock_code ON stock_valuation(stock_code);
CREATE INDEX IF NOT EXISTS idx_stock_valuation_date ON stock_valuation(stock_code, record_date);
