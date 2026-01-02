// Cloudflare Workers Bindings
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

// Database Models
export interface User {
  id: string;
  google_id: string | null;
  email: string;
  name: string | null;
  password_hash: string | null;
  email_verified: number;
  email_verification_token: string | null;
  email_verification_expires_at: string | null;
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

// 決算発表（短信+プレゼンのセット、または中計など）
export type ReleaseType = 'quarterly_earnings' | 'growth_potential';
export type DocumentType = 'earnings_summary' | 'earnings_presentation' | 'growth_potential';

export interface EarningsRelease {
  id: string;
  release_type: ReleaseType;
  stock_code: string;
  fiscal_year: string;
  fiscal_quarter: number | null;  // NULL for growth_potential
  summary: string | null;         // LLM分析結果（JSON）
  highlights: string | null;      // JSON配列
  lowlights: string | null;       // JSON配列
  created_at: string;
  updated_at: string;
}

// 個別ドキュメント（PDF）
export interface Earnings {
  id: string;
  release_id: string | null;      // EarningsRelease への参照
  document_type: DocumentType | null;
  stock_code: string;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  content_hash: string | null;   // PDF の MD5 ハッシュ
  r2_key: string | null;         // R2 オブジェクトキー
  document_title: string | null; // ドキュメントタイトル
  raw_data: string | null;
  summary: string | null;        // 旧: 個別分析結果（後方互換）
  highlights: string | null;
  lowlights: string | null;
  created_at: string;
}

export interface UserEarningsAnalysis {
  id: string;
  user_id: string;
  earnings_id: string;           // 旧: 後方互換
  release_id: string | null;     // 新: EarningsRelease への参照
  custom_analysis: string | null;
  custom_prompt_used: string | null;
  notified_at: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  earnings_id: string;           // 旧: 後方互換
  release_id: string | null;     // 新: EarningsRelease への参照
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface CustomAnalysisHistory {
  id: string;
  user_id: string;
  earnings_id: string;           // 旧: 後方互換
  release_id: string | null;     // 新: EarningsRelease への参照
  custom_prompt: string;
  analysis: string;
  created_at: string;
}

// API Types
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

// カスタムプロンプト分析の構造化結果
export interface CustomAnalysisSummary {
  overview: string;      // カスタム観点での概要
  highlights: string[];  // カスタム観点でのハイライト
  lowlights: string[];   // カスタム観点でのローライト
  analysis: string;      // 詳細分析
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export interface JWTPayload {
  sub: string; // user_id
  email: string;
  exp: number;
}
