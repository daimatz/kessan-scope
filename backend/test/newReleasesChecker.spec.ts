import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkNewReleases } from '../src/services/newReleasesChecker';

// TdnetClient のモック
vi.mock('../src/services/tdnet', () => ({
  TdnetClient: vi.fn().mockImplementation(() => ({
    getRecentDocuments: vi.fn().mockResolvedValue([
      {
        id: 'doc1',
        company_code: '72030',
        title: '2026年3月期第2四半期決算短信',
        pubdate: '2025-11-01 15:00',
        document_url: 'https://example.com/doc1.pdf',
      },
      {
        id: 'doc2',
        company_code: '67580',
        title: '役員人事のお知らせ',
        pubdate: '2025-11-01 16:00',
        document_url: 'https://example.com/doc2.pdf',
      },
    ]),
    filterStrategicDocuments: vi.fn().mockImplementation((docs) =>
      docs.filter((d: { title: string }) =>
        d.title.includes('決算') || d.title.includes('経営計画')
      )
    ),
  })),
}));

// DocumentClassifier のモック
vi.mock('../src/services/documentClassifier', () => ({
  DocumentClassifier: vi.fn().mockImplementation(() => ({
    classifyBatch: vi.fn().mockImplementation(async (items) =>
      items.map((item: { title: string }) => {
        if (item.title.includes('決算短信')) {
          return {
            document_type: 'earnings_summary',
            fiscal_year: '2025',
            fiscal_quarter: 2,
            confidence: 0.95,
            reasoning: 'Mock',
          };
        }
        return {
          document_type: 'other',
          fiscal_year: null,
          fiscal_quarter: null,
          confidence: 0.9,
          reasoning: 'Mock',
        };
      })
    ),
  })),
}));

// pdfStorage のモック
vi.mock('../src/services/pdfStorage', () => ({
  fetchAndStorePdf: vi.fn().mockResolvedValue({
    contentHash: 'hash123',
    r2Key: 'pdfs/7203/2025/hash123.pdf',
    fileSize: 12345,
  }),
}));

// earningsAnalyzer のモック
vi.mock('../src/services/earningsAnalyzer', () => ({
  analyzeEarningsRelease: vi.fn().mockResolvedValue({
    customAnalysisCount: 1,
  }),
}));

// DB queries のモック
vi.mock('../src/db/queries', () => ({
  getExistingContentHashes: vi.fn().mockResolvedValue(new Set<string>()),
  checkUrlExists: vi.fn().mockResolvedValue(false),
  getOrCreateEarningsRelease: vi.fn().mockResolvedValue({
    id: 'release-123',
    release_type: 'quarterly_earnings',
    stock_code: '7203',
    fiscal_year: '2025',
    fiscal_quarter: 2,
  }),
  getDocumentCountForRelease: vi.fn().mockResolvedValue(0),
  createEarningsWithRelease: vi.fn().mockResolvedValue(undefined),
}));

// モック用の env
function createMockEnv(watchlistStocks: string[] = []) {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: watchlistStocks.map((code) => ({ stock_code: code })),
        }),
      }),
    },
    PDF_BUCKET: {},
    OPENAI_API_KEY: 'test-key',
    MAILERSEND_API_KEY: 'test-key',
    MAILERSEND_FROM_EMAIL: 'test@example.com',
    FRONTEND_URL: 'https://example.com',
  } as unknown as import('../src/types').Env;
}

describe('newReleasesChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkNewReleases', () => {
    it('ウォッチリストが空の場合、何もチェックしない', async () => {
      const env = createMockEnv([]);

      const result = await checkNewReleases(env);

      expect(result).toEqual({ checked: 0, imported: 0 });
    });

    it('ウォッチリストの銘柄をチェックする', async () => {
      const env = createMockEnv(['7203', '6758']);

      const result = await checkNewReleases(env);

      expect(result.checked).toBe(2);
    });

    it('対象ドキュメントがない場合、インポート数は0', async () => {
      const env = createMockEnv(['9999']); // マッチしない銘柄

      const result = await checkNewReleases(env);

      expect(result.checked).toBe(1);
      expect(result.imported).toBe(0);
    });

    it('決算短信をインポートする', async () => {
      const env = createMockEnv(['7203']);

      const result = await checkNewReleases(env);

      expect(result.imported).toBe(1);
    });

    it('対象外のドキュメントはスキップされる', async () => {
      const env = createMockEnv(['6758']); // 役員人事のお知らせの銘柄

      const result = await checkNewReleases(env);

      // 6758 の決算短信がないので、インポートは0
      expect(result.imported).toBe(0);
    });
  });
});
