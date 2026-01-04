// ============================================
// Cloudflare Workers 固有の型
// ============================================

export interface Env {
  DB: D1Database;
  PDF_BUCKET: R2Bucket;
  IMPORT_QUEUE: Queue<QueueMessage>;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  MAILERSEND_API_KEY: string;
  MAILERSEND_FROM_EMAIL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  ENVIRONMENT?: string; // 'production' | 'development'
}

// Queue message types
export interface ImportQueueMessage {
  type: 'import_historical_earnings';
  stockCode: string;
  stockName: string | null;
  userId: string;
  userEmail: string;
}

export interface RegenerateQueueMessage {
  type: 'regenerate_custom_analysis';
  watchlistItemId: string;
  userId: string;
  userEmail: string;
}

export type QueueMessage = ImportQueueMessage | RegenerateQueueMessage;

// ============================================
// Database Models（DB カラムをそのまま反映）
// ============================================

export interface User {
  id: string;
  google_id: string | null;
  email: string;
  name: string | null;
  email_verified: number;
  created_at: string;
  updated_at: string;
}

export interface WatchlistItem {
  id: string;
  user_id: string;
  stock_code: string;
  stock_name: string | null;
  custom_prompt: string | null;
  created_at: string;
}

export type ReleaseType = 'quarterly_earnings' | 'growth_potential';
export type DocumentType = 'earnings_summary' | 'earnings_presentation' | 'growth_potential';

export interface EarningsRelease {
  id: string;
  release_type: ReleaseType;
  stock_code: string;
  fiscal_year: string;
  fiscal_quarter: number | null;
  announcement_date: string | null;
  summary: string | null;
  highlights: string | null;
  lowlights: string | null;
  created_at: string;
  updated_at: string;
}

export interface Earnings {
  id: string;
  release_id: string | null;
  document_type: DocumentType | null;
  stock_code: string;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  content_hash: string | null;
  r2_key: string | null;
  document_title: string | null;
  file_size: number | null;
  raw_data: string | null;
  summary: string | null;
  highlights: string | null;
  lowlights: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  release_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// ============================================
// 認証関連の型
// ============================================

export interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export interface JWTPayload {
  sub: string;
  email: string;
  exp: number;
}

// ============================================
// Claude API 用の型（内部処理用）
// ============================================

export interface EarningsSummary {
  overview: string;
  highlights: string[];
  lowlights: string[];
  keyMetrics: {
    revenue: string;
    operatingIncome: string;
    netIncome: string;
    yoyGrowth: string;
  };
}

export interface CustomAnalysisSummary {
  overview: string;
  highlights: string[];
  lowlights: string[];
  analysis: string;
}
