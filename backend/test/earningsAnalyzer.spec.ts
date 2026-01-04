import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeEarningsRelease, regenerateCustomAnalysis } from '../src/services/earningsAnalyzer';
import * as dbQueries from '../src/db/queries';
import type { EarningsRelease, WatchlistItem } from '../src/types';

// ClaudeService のモック
vi.mock('../src/services/claude', () => ({
  ClaudeService: vi.fn().mockImplementation(() => ({
    analyzeEarningsPdfs: vi.fn().mockResolvedValue({
      overview: 'テスト概要',
      highlights: ['ハイライト1', 'ハイライト2'],
      lowlights: ['ローライト1'],
      keyMetrics: [],
    }),
    analyzeWithCustomPromptMultiplePdfs: vi.fn().mockResolvedValue({
      answer: 'カスタム分析結果',
    }),
  })),
}));

// pdfStorage のモック
vi.mock('../src/services/pdfStorage', () => ({
  getPdfFromR2: vi.fn().mockResolvedValue(new ArrayBuffer(1000)),
}));

// mailersend のモック
vi.mock('../src/services/mailersend', () => ({
  MailerSendClient: vi.fn().mockImplementation(() => ({
    sendEarningsNotification: vi.fn().mockResolvedValue(undefined),
  })),
}));

// DB queries のモック
vi.mock('../src/db/queries');

// モック用の env
function createMockEnv() {
  return {
    DB: {},
    PDF_BUCKET: {},
    ANTHROPIC_API_KEY: 'test-key',
    OPENAI_API_KEY: 'test-key',
    MAILERSEND_API_KEY: 'test-key',
    MAILERSEND_FROM_EMAIL: 'test@example.com',
    FRONTEND_URL: 'https://example.com',
  } as unknown as import('../src/types').Env;
}

// モック用のリリースデータ
const mockRelease: EarningsRelease = {
  id: 'release-123',
  release_type: 'quarterly_earnings',
  stock_code: '7203',
  fiscal_year: '2025',
  fiscal_quarter: 2,
  summary: null,
  highlights: null,
  lowlights: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

describe('earningsAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // デフォルトのモック実装
    vi.mocked(dbQueries.updateEarningsReleaseAnalysis).mockResolvedValue(undefined);
    vi.mocked(dbQueries.getWatchlistItemsWithoutAnalysis).mockResolvedValue([]);
    vi.mocked(dbQueries.createUserAnalysisForRelease).mockResolvedValue(undefined);
    vi.mocked(dbQueries.getUsersToNotifyForRelease).mockResolvedValue([]);
    vi.mocked(dbQueries.markUserReleaseNotified).mockResolvedValue(undefined);
    vi.mocked(dbQueries.getEarningsReleasesByStockCode).mockResolvedValue([]);
    vi.mocked(dbQueries.getUserAnalysisByRelease).mockResolvedValue(null);
    vi.mocked(dbQueries.findCachedAnalysisForRelease).mockResolvedValue(null);
    vi.mocked(dbQueries.updateUserAnalysisForRelease).mockResolvedValue(undefined);
    vi.mocked(dbQueries.saveCustomAnalysisForRelease).mockResolvedValue(undefined);
  });

  describe('analyzeEarningsRelease', () => {
    it('リリースが見つからない場合、null を返す', async () => {
      vi.mocked(dbQueries.getEarningsReleaseById).mockResolvedValue(null);
      const env = createMockEnv();

      const result = await analyzeEarningsRelease(env, 'non-existent');

      expect(result).toBeNull();
    });

    it('PDFがない場合、null を返す', async () => {
      vi.mocked(dbQueries.getEarningsReleaseById).mockResolvedValue(mockRelease);
      vi.mocked(dbQueries.getDocumentsForRelease).mockResolvedValue([]);
      const env = createMockEnv();

      const result = await analyzeEarningsRelease(env, 'release-123');

      expect(result).toBeNull();
    });

    it('PDFがあれば分析を実行しサマリーを保存する', async () => {
      vi.mocked(dbQueries.getEarningsReleaseById).mockResolvedValue(mockRelease);
      vi.mocked(dbQueries.getDocumentsForRelease).mockResolvedValue([
        {
          id: 'doc-1',
          stock_code: '7203',
          fiscal_year: '2025',
          fiscal_quarter: 2,
          announcement_date: '2025-11-01',
          content_hash: 'hash',
          r2_key: 'pdfs/7203/2025/hash.pdf',
          document_url: 'https://example.com/doc.pdf',
          document_title: 'テスト',
          file_size: 1000,
          release_id: 'release-123',
          document_type: 'earnings_summary',
          created_at: '2025-01-01',
        },
      ]);
      const env = createMockEnv();

      const result = await analyzeEarningsRelease(env, 'release-123');

      expect(result).not.toBeNull();
      expect(result?.summary).toBeDefined();
      expect(result?.summary.highlights).toHaveLength(2);
      expect(dbQueries.updateEarningsReleaseAnalysis).toHaveBeenCalled();
    });

    it('分析は通知を送らない（通知は呼び出し元の責任）', async () => {
      vi.mocked(dbQueries.getEarningsReleaseById).mockResolvedValue(mockRelease);
      vi.mocked(dbQueries.getDocumentsForRelease).mockResolvedValue([
        {
          id: 'doc-1',
          stock_code: '7203',
          fiscal_year: '2025',
          fiscal_quarter: 2,
          announcement_date: '2025-11-01',
          content_hash: 'hash',
          r2_key: 'pdfs/7203/2025/hash.pdf',
          document_url: 'https://example.com/doc.pdf',
          document_title: 'テスト',
          file_size: 1000,
          release_id: 'release-123',
          document_type: 'earnings_summary',
          created_at: '2025-01-01',
        },
      ]);
      const env = createMockEnv();

      const result = await analyzeEarningsRelease(env, 'release-123');

      // 分析は成功する
      expect(result).not.toBeNull();
      // 通知関連のDBメソッドは呼ばれない
      expect(dbQueries.getUsersToNotifyForRelease).not.toHaveBeenCalled();
      expect(dbQueries.markUserReleaseNotified).not.toHaveBeenCalled();
    });

    it('カスタムプロンプトがあるユーザーにはカスタム分析を生成する', async () => {
      vi.mocked(dbQueries.getEarningsReleaseById).mockResolvedValue(mockRelease);
      vi.mocked(dbQueries.getDocumentsForRelease).mockResolvedValue([
        {
          id: 'doc-1',
          stock_code: '7203',
          fiscal_year: '2025',
          fiscal_quarter: 2,
          announcement_date: '2025-11-01',
          content_hash: 'hash',
          r2_key: 'pdfs/7203/2025/hash.pdf',
          document_url: 'https://example.com/doc.pdf',
          document_title: 'テスト',
          file_size: 1000,
          release_id: 'release-123',
          document_type: 'earnings_summary',
          created_at: '2025-01-01',
        },
      ]);
      vi.mocked(dbQueries.getWatchlistItemsWithoutAnalysis).mockResolvedValue([
        {
          user_id: 'user-1',
          custom_prompt: '配当に関する情報を抽出してください',
        },
      ]);
      const env = createMockEnv();

      const result = await analyzeEarningsRelease(env, 'release-123');

      expect(result?.customAnalysisCount).toBe(1);
      expect(dbQueries.createUserAnalysisForRelease).toHaveBeenCalled();
    });
  });

  describe('regenerateCustomAnalysis', () => {
    it('カスタムプロンプトがない場合、何もしない', async () => {
      const env = createMockEnv();
      const watchlistItem: WatchlistItem = {
        id: 'wl-1',
        user_id: 'user-1',
        stock_code: '7203',
        stock_name: 'トヨタ自動車',
        custom_prompt: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const result = await regenerateCustomAnalysis(env, watchlistItem);

      expect(result).toEqual({ total: 0, regenerated: 0, cached: 0, skipped: 0 });
    });

    it('カスタムプロンプトがある場合、全リリースの分析を再生成する', async () => {
      vi.mocked(dbQueries.getEarningsReleasesByStockCode).mockResolvedValue([mockRelease]);
      vi.mocked(dbQueries.getDocumentsForRelease).mockResolvedValue([
        {
          id: 'doc-1',
          stock_code: '7203',
          fiscal_year: '2025',
          fiscal_quarter: 2,
          announcement_date: '2025-11-01',
          content_hash: 'hash',
          r2_key: 'pdfs/7203/2025/hash.pdf',
          document_url: 'https://example.com/doc.pdf',
          document_title: 'テスト',
          file_size: 1000,
          release_id: 'release-123',
          document_type: 'earnings_summary',
          created_at: '2025-01-01',
        },
      ]);
      const env = createMockEnv();
      const watchlistItem: WatchlistItem = {
        id: 'wl-1',
        user_id: 'user-1',
        stock_code: '7203',
        stock_name: 'トヨタ自動車',
        custom_prompt: '配当に関する情報を抽出してください',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const result = await regenerateCustomAnalysis(env, watchlistItem);

      expect(result.total).toBe(1);
      expect(result.regenerated).toBe(1);
    });

    it('同じプロンプトで既に分析済みならキャッシュを使用する', async () => {
      vi.mocked(dbQueries.getEarningsReleasesByStockCode).mockResolvedValue([mockRelease]);
      vi.mocked(dbQueries.getUserAnalysisByRelease).mockResolvedValue({
        id: 'analysis-1',
        user_id: 'user-1',
        release_id: 'release-123',
        custom_prompt_used: 'カスタムプロンプト',
        custom_analysis: '{"answer": "cached"}',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        notified_at: null,
      });
      const env = createMockEnv();
      const watchlistItem: WatchlistItem = {
        id: 'wl-1',
        user_id: 'user-1',
        stock_code: '7203',
        stock_name: 'トヨタ自動車',
        custom_prompt: 'カスタムプロンプト',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const result = await regenerateCustomAnalysis(env, watchlistItem);

      expect(result.total).toBe(1);
      expect(result.cached).toBe(1);
      expect(result.regenerated).toBe(0);
    });
  });
});
