import { describe, it, expect, vi } from 'vitest';
import { DocumentClassifier, toOldDocumentType } from '../src/services/documentClassifier';

// OpenAI API のモック
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async ({ messages }) => {
            const userMessage = messages.find((m: { role: string }) => m.role === 'user')?.content || '';

            // タイトルに基づいてモックレスポンスを返す
            let response = {
              document_type: 'other',
              fiscal_year: null,
              fiscal_quarter: null,
              confidence: 0.9,
              reasoning: 'Mock response',
            };

            if (userMessage.includes('決算短信')) {
              response = {
                document_type: 'earnings_summary',
                fiscal_year: '2025',
                fiscal_quarter: 2,
                confidence: 0.95,
                reasoning: '決算短信を含むタイトル',
              };
            } else if (userMessage.includes('決算説明')) {
              response = {
                document_type: 'earnings_presentation',
                fiscal_year: '2025',
                fiscal_quarter: 2,
                confidence: 0.95,
                reasoning: '決算説明を含むタイトル',
              };
            } else if (userMessage.includes('中期経営計画')) {
              response = {
                document_type: 'growth_potential',
                fiscal_year: '2025',
                fiscal_quarter: null,
                confidence: 0.9,
                reasoning: '中期経営計画を含むタイトル',
              };
            }

            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify(response),
                  },
                },
              ],
            };
          }),
        },
      },
    })),
  };
});

describe('DocumentClassifier', () => {
  const classifier = new DocumentClassifier('test-api-key');

  describe('classify', () => {
    it('決算短信を正しく分類', async () => {
      const result = await classifier.classify('2026年3月期第2四半期決算短信〔IFRS〕(連結)');
      expect(result.document_type).toBe('earnings_summary');
      expect(result.fiscal_year).toBe('2025');
      expect(result.fiscal_quarter).toBe(2);
    });

    it('決算説明資料を正しく分類', async () => {
      const result = await classifier.classify('2026年3月期第2四半期決算説明会資料');
      expect(result.document_type).toBe('earnings_presentation');
    });

    it('中期経営計画を正しく分類', async () => {
      const result = await classifier.classify('中期経営計画（2024-2027）');
      expect(result.document_type).toBe('growth_potential');
      expect(result.fiscal_quarter).toBeNull();
    });

    it('対象外を正しく分類', async () => {
      const result = await classifier.classify('役員人事に関するお知らせ');
      expect(result.document_type).toBe('other');
    });
  });

  describe('isTargetDocument', () => {
    it('earnings_summary は対象', async () => {
      const classification = await classifier.classify('決算短信');
      expect(classifier.isTargetDocument(classification)).toBe(true);
    });

    it('other は対象外', async () => {
      const classification = await classifier.classify('役員人事');
      expect(classifier.isTargetDocument(classification)).toBe(false);
    });
  });
});

describe('toOldDocumentType', () => {
  it('earnings_summary を変換', () => {
    expect(toOldDocumentType('earnings_summary')).toBe('earnings_summary');
  });

  it('earnings_presentation を変換', () => {
    expect(toOldDocumentType('earnings_presentation')).toBe('earnings_presentation');
  });

  it('growth_potential を midterm_plan に変換', () => {
    expect(toOldDocumentType('growth_potential')).toBe('midterm_plan');
  });

  it('other を変換', () => {
    expect(toOldDocumentType('other')).toBe('other');
  });
});
