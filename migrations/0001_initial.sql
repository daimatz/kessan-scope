-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  openai_model TEXT DEFAULT 'gpt-4o',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Watchlist table
CREATE TABLE IF NOT EXISTS watchlist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  custom_prompt TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, stock_code)
);

-- Index for faster watchlist lookups
CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_stock_code ON watchlist(stock_code);

-- Earnings table
CREATE TABLE IF NOT EXISTS earnings (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  fiscal_quarter INTEGER NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
  announcement_date DATE NOT NULL,
  edinet_doc_id TEXT,
  raw_data TEXT,
  summary TEXT,
  highlights TEXT,
  lowlights TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(stock_code, fiscal_year, fiscal_quarter)
);

-- Index for faster earnings lookups
CREATE INDEX IF NOT EXISTS idx_earnings_stock_code ON earnings(stock_code);
CREATE INDEX IF NOT EXISTS idx_earnings_announcement_date ON earnings(announcement_date);

-- User earnings analysis table
CREATE TABLE IF NOT EXISTS user_earnings_analysis (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earnings_id TEXT NOT NULL REFERENCES earnings(id) ON DELETE CASCADE,
  custom_analysis TEXT,
  notified_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, earnings_id)
);

-- Index for faster analysis lookups
CREATE INDEX IF NOT EXISTS idx_user_earnings_analysis_user_id ON user_earnings_analysis(user_id);
CREATE INDEX IF NOT EXISTS idx_user_earnings_analysis_earnings_id ON user_earnings_analysis(earnings_id);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earnings_id TEXT NOT NULL REFERENCES earnings(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster chat lookups
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_earnings ON chat_messages(user_id, earnings_id);
