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
};

// Earnings API
export const earningsAPI = {
  getAll: () => fetchAPI<{ earnings: Earnings[] }>('/api/earnings'),
  getById: (id: string) =>
    fetchAPI<{ earnings: EarningsDetail; userAnalysis: string | null; notifiedAt: string | null }>(
      `/api/earnings/${id}`
    ),
  getByStock: (code: string) =>
    fetchAPI<{ stock_code: string; earnings: EarningsHistory[] }>(`/api/earnings/stock/${code}`),
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
  summary: EarningsSummary | null;
  highlights: string[];
  lowlights: string[];
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

export interface EarningsHistory {
  id: string;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  has_summary: boolean;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  earnings_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
