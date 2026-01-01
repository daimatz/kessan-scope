// Cloudflare Workers Bindings
export interface Env {
  DB: D1Database;
  EDINET_API_KEY: string;
  OPENAI_API_KEY: string;
  MAILERSEND_API_KEY: string;
  MAILERSEND_FROM_EMAIL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
}

// Database Models
export interface User {
  id: string;
  google_id: string | null;
  email: string;
  name: string | null;
  password_hash: string | null;
  openai_model: string;
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

export interface Earnings {
  id: string;
  stock_code: string;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  edinet_doc_id: string | null;
  raw_data: string | null;
  summary: string | null;
  highlights: string | null;
  lowlights: string | null;
  created_at: string;
}

export interface UserEarningsAnalysis {
  id: string;
  user_id: string;
  earnings_id: string;
  custom_analysis: string | null;
  notified_at: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  earnings_id: string;
  role: 'user' | 'assistant';
  content: string;
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
