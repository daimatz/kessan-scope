const API_BASE = import.meta.env.VITE_API_URL || '';

export class APIError extends Error {
  requiresVerification?: boolean;
  email?: string;

  constructor(message: string, data?: { requiresVerification?: boolean; email?: string }) {
    super(message);
    this.requiresVerification = data?.requiresVerification;
    this.email = data?.email;
  }
}

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new APIError(errorData.error || 'Request failed', {
      requiresVerification: errorData.requiresVerification,
      email: errorData.email,
    });
  }

  return response.json();
}

// Auth API
export const authAPI = {
  getMe: () => fetchAPI<{ user: User | null }>('/api/auth/me'),
  logout: () => fetchAPI<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  getGoogleAuthUrl: () => `${API_BASE}/api/auth/google`,
  register: (data: { email: string; password: string; name?: string; confirmLinkPassword?: boolean }) =>
    fetchAPI<{ user?: User; message?: string; requiresVerification?: boolean; existingGoogleAccount?: boolean; email?: string; passwordLinked?: boolean }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  login: (data: { email: string; password: string }) =>
    fetchAPI<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  resendVerification: (email: string) =>
    fetchAPI<{ message: string }>('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
};

// Watchlist API
export const watchlistAPI = {
  getAll: () => fetchAPI<{ items: WatchlistItem[] }>('/api/watchlist'),
  add: (data: { stock_code: string; stock_name?: string; custom_prompt?: string }) =>
    fetchAPI<{ item: WatchlistItem; importStarted?: boolean; message?: string }>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  remove: (id: string) =>
    fetchAPI<{ success: boolean }>(`/api/watchlist/${id}`, { method: 'DELETE' }),
  update: (id: string, data: { stock_name?: string; custom_prompt?: string }) =>
    fetchAPI<{ success: boolean }>(`/api/watchlist/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  regenerate: (id: string) =>
    fetchAPI<{ success: boolean; message?: string }>(`/api/watchlist/${id}/regenerate`, {
      method: 'POST',
    }),
};

// Earnings API
export const earningsAPI = {
  getAll: () => fetchAPI<{ earnings: Earnings[] }>('/api/earnings'),
  getById: (id: string) =>
    fetchAPI<EarningsDetailResponse>(`/api/earnings/${id}`),
  getByStock: (code: string) =>
    fetchAPI<StockDetailResponse>(`/api/earnings/stock/${code}`),
  getPdfUrl: (id: string) => `${API_BASE}/api/earnings/${id}/pdf`,
};

// Chat API
export const chatAPI = {
  getMessages: (earningsId: string) =>
    fetchAPI<{ messages: ChatMessage[] }>(`/api/chat/${earningsId}`),
  sendMessage: (earningsId: string, message: string) =>
    fetchAPI<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>(
      `/api/chat/${earningsId}`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      }
    ),
};

// Stocks API
export const stocksAPI = {
  search: (query: string) =>
    fetchAPI<{ stocks: Stock[] }>(`/api/stocks/search?q=${encodeURIComponent(query)}`),
};

export interface Stock {
  code: string;
  name: string;
  market: string | null;
  sector: string | null;
}

// Users API
export const usersAPI = {
  updateSettings: (data: { openai_model?: string; name?: string }) =>
    fetchAPI<{ success: boolean }>('/api/users/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

// Types
export interface User {
  id: string;
  email: string;
  name: string | null;
  openai_model: string;
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
  stock_name: string | null;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  custom_analysis: string | null;
  notified_at: string | null;
}

export interface EarningsDetail {
  id: string;
  stock_code: string;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  document_title: string | null;
  r2_key: string | null;
  summary: EarningsSummary | null;
  highlights: string[];
  lowlights: string[];
}

export interface AnalysisByPrompt {
  prompt: string;
  analysis: string;
  created_at: string;
}

export interface EarningsNavItem {
  id: string;
  fiscal_year: string;
  fiscal_quarter: number;
}

export interface EarningsDetailResponse {
  earnings: EarningsDetail;
  notifiedAt: string | null;
  // 銘柄で使用されたすべてのユニークなプロンプト（分析軸）
  availablePrompts: string[];
  // この決算資料に対するすべての分析（プロンプトごと）
  analysesByPrompt: AnalysisByPrompt[];
  prevEarnings: EarningsNavItem | null;
  nextEarnings: EarningsNavItem | null;
}

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

// JSON文字列からCustomAnalysisSummaryをパース
export function parseCustomAnalysis(jsonString: string | null): CustomAnalysisSummary | null {
  if (!jsonString) return null;
  try {
    return JSON.parse(jsonString) as CustomAnalysisSummary;
  } catch {
    // 古い形式（プレーンテキスト）の場合はanalysisフィールドのみ
    return {
      overview: '',
      highlights: [],
      lowlights: [],
      analysis: jsonString,
    };
  }
}

export interface EarningsHistory {
  id: string;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  document_title: string | null;
  has_summary: boolean;
  has_pdf: boolean;
  has_custom_analysis: boolean;
  analysis_history_count: number;
}

export interface StockDetailResponse {
  stock_code: string;
  stock_name: string | null;
  custom_prompt: string | null;
  watchlist_id: string | null;
  earnings: EarningsHistory[];
}

export interface ChatMessage {
  id: string;
  user_id: string;
  earnings_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
