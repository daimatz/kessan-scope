// LLM によるドキュメント分類サービス
// OpenAI gpt-4o-mini + Structured Outputs

import OpenAI from 'openai';
import { LLM_BATCH_SIZE } from '../constants';

export interface DocumentClassification {
  document_type: 'earnings_summary' | 'earnings_presentation' | 'growth_potential' | 'other';
  fiscal_year: string | null;
  fiscal_quarter: number | null; // 1-4 (通期は4), null は中計など
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `あなたは日本の上場企業のIR資料を分類する専門家です。
与えられたドキュメントタイトルと発表日から、以下の情報を判定してください。

## 文書種類 (document_type)
- earnings_summary: 決算短信（「決算短信」を含むタイトル）
- earnings_presentation: 決算発表資料（決算説明資料、決算補足資料、決算報告、Fact Sheet、決算ハイライト、プレゼンテーション資料など）
- growth_potential: 成長可能性の説明資料（中期経営計画、成長可能性、長期ビジョン、事業戦略、経営戦略など）
- other: 上記以外（業績予想修正、配当予想、株式分割、人事など）

## 年度 (fiscal_year) - 具体例

重要: タイトルに含まれる年の数字をそのまま使用してください。計算や変換は不要です。

### FY表記
- 「FY2026.6 1Q決算説明資料」→ fiscal_year: "2026", fiscal_quarter: 1
- 「FY2025 Q2決算短信」→ fiscal_year: "2025", fiscal_quarter: 2
- 「FY25 3Q」→ fiscal_year: "2025", fiscal_quarter: 3

### X年Y月期表記（年の数字をそのまま使用）
- 「2026年6月期第1四半期決算短信」→ fiscal_year: "2026", fiscal_quarter: 1
- 「2026年3月期 第1四半期決算短信」→ fiscal_year: "2026", fiscal_quarter: 1
- 「2026年6月期 通期決算説明資料」→ fiscal_year: "2026", fiscal_quarter: 4
- 「2025年12月期 第3四半期」→ fiscal_year: "2025", fiscal_quarter: 3

### 年度表記
- 「2025年度 第1四半期決算短信」→ fiscal_year: "2025", fiscal_quarter: 1
- 「令和6年度 中間決算」→ fiscal_year: "2024", fiscal_quarter: 2

### 和暦X年Y月期（西暦に変換）
- 「令和7年3月期 決算短信」→ fiscal_year: "2025", fiscal_quarter: 4（令和7年=2025年）
- 「平成26年3月期 第2四半期」→ fiscal_year: "2014", fiscal_quarter: 2（平成26年=2014年）

## 四半期 (fiscal_quarter)
- 第1四半期、1Q、Q1 → 1
- 第2四半期、2Q、Q2、中間期、上期 → 2
- 第3四半期、3Q、Q3 → 3
- 第4四半期、4Q、Q4、通期、期末、年度末、本決算 → 4
- 「第X四半期」の記載がない決算短信/説明資料 → 4（通期と推定）
- 中期経営計画など四半期に紐づかない資料 → null

正確に判定してください。`;

const CLASSIFICATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    document_type: {
      type: 'string' as const,
      enum: ['earnings_summary', 'earnings_presentation', 'growth_potential', 'other'],
      description: '文書の種類',
    },
    fiscal_year: {
      type: ['string', 'null'] as const,
      description: '年度（西暦、例: "2025"）',
    },
    fiscal_quarter: {
      type: ['integer', 'null'] as const,
      description: '四半期（1-4）、四半期に紐づかない場合は null',
    },
    confidence: {
      type: 'number' as const,
      description: '判定の確信度（0.0-1.0）',
    },
    reasoning: {
      type: 'string' as const,
      description: '判定の理由',
    },
  },
  required: ['document_type', 'fiscal_year', 'fiscal_quarter', 'confidence', 'reasoning'] as const,
  additionalProperties: false as const,
};

export class DocumentClassifier {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async classify(title: string, pubdate?: string): Promise<DocumentClassification> {
    const userMessage = pubdate
      ? `タイトル: ${title}\n発表日: ${pubdate}`
      : `タイトル: ${title}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'document_classification',
          strict: true,
          schema: CLASSIFICATION_SCHEMA,
        },
      },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No content in response');
    }

    return JSON.parse(content) as DocumentClassification;
  }

  // バッチ処理用（コスト効率化のため1回のリクエストで複数分類）
  async classifyBatch(
    documents: Array<{ title: string; pubdate?: string }>
  ): Promise<DocumentClassification[]> {
    // 並列実行（レート制限に注意）
    const results: DocumentClassification[] = [];

    for (let i = 0; i < documents.length; i += LLM_BATCH_SIZE) {
      const batch = documents.slice(i, i + LLM_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((doc) => this.classify(doc.title, doc.pubdate))
      );
      results.push(...batchResults);
    }

    return results;
  }

  // 対象ドキュメントかどうかを判定（other 以外）
  isTargetDocument(classification: DocumentClassification): boolean {
    return classification.document_type !== 'other';
  }
}
