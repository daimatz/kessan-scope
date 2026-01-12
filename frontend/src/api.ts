// 共有型を import
import {
  type User as SharedUser,
  type WatchlistItem,
  type Stock,
  type EarningsSummary,
  type CustomAnalysisSummary,
  type ChatMessage,
  type ReleaseDocument,
  type ReleaseDetail,
  type ReleaseNavItem,
  type AnalysisHistoryItem,
  type ReleaseDetailResponse,
  type DashboardRelease,
  type ReleaseListItem,
  type StockReleasesResponse,
  type ReleaseType,
  type DocumentType,
  type StockValuation,
  type ValuationHistoryResponse,
  parseCustomAnalysis,
  getDocumentTypeLabel,
  getReleaseTypeLabel,
} from '@kessan-scope/shared';

// 型を re-export
export type {
  WatchlistItem,
  Stock,
  EarningsSummary,
  CustomAnalysisSummary,
  ChatMessage,
  ReleaseDocument,
  ReleaseDetail,
  ReleaseNavItem,
  AnalysisHistoryItem,
  ReleaseDetailResponse,
  DashboardRelease,
  ReleaseListItem,
  StockReleasesResponse,
  ReleaseType,
  DocumentType,
  StockValuation,
  ValuationHistoryResponse,
};

// 関数を re-export
export { parseCustomAnalysis, getDocumentTypeLabel, getReleaseTypeLabel };

// Frontend 固有の User 型（openai_model を含む）
export interface User extends SharedUser {
  openai_model: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export class APIError extends Error {
  constructor(message: string) {
    super(message);
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
    throw new APIError(errorData.error || 'Request failed');
  }

  return response.json();
}

// Auth API
export const authAPI = {
  getMe: () => fetchAPI<{ user: User | null }>('/api/auth/me'),
  logout: () => fetchAPI<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  getGoogleAuthUrl: () => `${API_BASE}/api/auth/google`,
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
  getAllReleases: () => fetchAPI<{ releases: DashboardRelease[] }>('/api/earnings/releases'),
  getReleaseById: (releaseId: string) =>
    fetchAPI<ReleaseDetailResponse>(`/api/earnings/release/${releaseId}`),
  getReleasesByStock: (code: string) =>
    fetchAPI<StockReleasesResponse>(`/api/earnings/releases/stock/${code}`),
  getReleasePdfUrl: (releaseId: string, documentType: string) =>
    `${API_BASE}/api/earnings/release/${releaseId}/pdf/${documentType}`,
  getReleasePdfUrlById: (releaseId: string, documentId: string) =>
    `${API_BASE}/api/earnings/release/${releaseId}/pdf/doc/${documentId}`,
};

// Chat API
export const chatAPI = {
  getReleaseMessages: (releaseId: string) =>
    fetchAPI<{ messages: ChatMessage[] }>(`/api/chat/release/${releaseId}`),
  sendReleaseMessageStream: (
    releaseId: string,
    message: string,
    callbacks: {
      onUserMessage: (id: string) => void;
      onDelta: (content: string) => void;
      onDone: (id: string) => void;
      onError: (error: string) => void;
    }
  ): Promise<void> => {
    return streamSSE(`${API_BASE}/api/chat/release/${releaseId}/stream`, message, callbacks);
  },
};

// SSE ストリーミング共通関数
async function streamSSE(
  url: string,
  message: string,
  callbacks: {
    onUserMessage: (id: string) => void;
    onDelta: (content: string) => void;
    onDone: (id: string) => void;
    onError: (error: string) => void;
  }
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new APIError(errorData.error || 'Request failed');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new APIError('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
      } else if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          switch (currentEvent) {
            case 'user_message':
              callbacks.onUserMessage(data.id);
              break;
            case 'delta':
              callbacks.onDelta(data.content);
              break;
            case 'done':
              callbacks.onDone(data.id);
              break;
            case 'error':
              callbacks.onError(data.error);
              break;
          }
        } catch {
          // ignore parse errors
        }
        currentEvent = '';
      }
    }
  }
}

// Stocks API
export const stocksAPI = {
  search: (query: string) =>
    fetchAPI<{ stocks: Stock[] }>(`/api/stocks/search?q=${encodeURIComponent(query)}`),
};

// Users API
export const usersAPI = {
  updateSettings: (data: { openai_model?: string; name?: string }) =>
    fetchAPI<{ success: boolean }>('/api/users/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

// Valuation API
export const valuationAPI = {
  getHistory: (code: string) =>
    fetchAPI<ValuationHistoryResponse>(`/api/valuation/${code}`),
  sync: (code: string) =>
    fetchAPI<{ success: boolean; synced: number }>(`/api/valuation/${code}/sync`, {
      method: 'POST',
    }),
};
