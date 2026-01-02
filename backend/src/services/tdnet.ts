// TDnet API Client (やのしん WEB-API)
// https://webapi.yanoshin.jp/tdnet/

const TDNET_API_BASE = 'https://webapi.yanoshin.jp/webapi/tdnet';

export interface TdnetDocument {
  id: string;
  pubdate: string; // "2025-11-05 14:25:00"
  company_code: string; // "72030"
  company_name: string;
  title: string;
  document_url: string;
  url_xbrl: string | null;
  markets_string: string;
}

interface TdnetApiResponse {
  total_count: number;
  condition_desc: string;
  items: Array<{
    Tdnet: TdnetDocument;
  }>;
}

// 決算短信かどうか判定
export function isEarningsSummary(title: string): boolean {
  return title.includes('決算短信');
}

// 決算発表資料かどうか判定
export function isEarningsPresentation(title: string): boolean {
  return (
    title.includes('決算説明') ||
    title.includes('決算報告プレゼンテーション') ||
    title.includes('決算補足') ||
    title.includes('説明会資料') ||
    title.includes('プレゼンテーション資料') ||
    title.includes('決算資料')
  );
}

// 中期経営計画かどうか判定
export function isMidTermPlan(title: string): boolean {
  return (
    title.includes('中期経営計画') ||
    title.includes('中期経営方針') ||
    title.includes('経営計画') ||
    title.includes('事業計画') ||
    title.includes('長期ビジョン') ||
    title.includes('成長戦略')
  );
}

// 事業戦略関連資料かどうか判定
export function isStrategyDocument(title: string): boolean {
  return (
    title.includes('事業戦略') ||
    title.includes('経営戦略') ||
    title.includes('事業説明') ||
    title.includes('事業方針') ||
    title.includes('資本政策') ||
    title.includes('株主還元') ||
    title.includes('IR説明') ||
    title.includes('IRプレゼンテーション') ||
    title.includes('事業ポートフォリオ')
  );
}

// 事業分析に重要なドキュメントかどうか（統合判定）
export function isStrategicDocument(title: string): boolean {
  return (
    isEarningsSummary(title) ||
    isEarningsPresentation(title) ||
    isMidTermPlan(title) ||
    isStrategyDocument(title)
  );
}

// ドキュメントタイプを判定
export type DocumentType = 'earnings_summary' | 'earnings_presentation' | 'midterm_plan' | 'strategy' | 'other';

export function getDocumentType(title: string): DocumentType {
  if (isEarningsSummary(title)) return 'earnings_summary';
  if (isEarningsPresentation(title)) return 'earnings_presentation';
  if (isMidTermPlan(title)) return 'midterm_plan';
  if (isStrategyDocument(title)) return 'strategy';
  return 'other';
}

// 四半期を判定（タイトルから）
// 中期経営計画など四半期に紐づかない資料は0を返す
export function determineFiscalQuarter(title: string): number {
  // 中期経営計画や戦略資料は四半期に紐づかない
  if (isMidTermPlan(title) || isStrategyDocument(title)) {
    return 0;
  }
  if (title.includes('第1四半期') || title.includes('第１四半期')) return 1;
  if (title.includes('第2四半期') || title.includes('第２四半期') || title.includes('中間')) return 2;
  if (title.includes('第3四半期') || title.includes('第３四半期')) return 3;
  if (title.includes('通期') || title.includes('期末') || (!title.includes('四半期'))) return 4;
  return 0;
}

// 年度を判定（タイトルまたは発表日から）
export function determineFiscalYear(title: string, pubdate?: string): string {
  // "2026年3月期" or "令和8年3月期" などのパターン
  const match = title.match(/(\d{4})年\d{1,2}月期/);
  if (match) {
    // 3月期の場合、2026年3月期 → 2025年度
    return String(parseInt(match[1], 10) - 1);
  }

  // 中期経営計画など年度表記がない場合は発表日から判定
  if (pubdate) {
    const year = pubdate.split('-')[0];
    return year;
  }

  return '';
}

export class TdnetClient {
  // 銘柄の適時開示一覧を取得
  async getDocumentsByStock(stockCode: string, limit: number = 300): Promise<TdnetDocument[]> {
    // 4桁コードを使用
    const code = stockCode.slice(0, 4);
    const url = `${TDNET_API_BASE}/list/${code}.json?limit=${limit}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TDnet API error: ${response.status}`);
    }

    const data = (await response.json()) as TdnetApiResponse;
    return data.items.map((item) => item.Tdnet);
  }

  // 最新の適時開示一覧を取得
  async getRecentDocuments(limit: number = 100): Promise<TdnetDocument[]> {
    const url = `${TDNET_API_BASE}/list/recent.json?limit=${limit}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TDnet API error: ${response.status}`);
    }

    const data = (await response.json()) as TdnetApiResponse;
    return data.items.map((item) => item.Tdnet);
  }

  // 決算短信のみフィルタリング
  filterEarningsSummaries(documents: TdnetDocument[]): TdnetDocument[] {
    return documents.filter((doc) => isEarningsSummary(doc.title));
  }

  // 決算発表資料のみフィルタリング
  filterEarningsPresentations(documents: TdnetDocument[]): TdnetDocument[] {
    return documents.filter((doc) => isEarningsPresentation(doc.title));
  }

  // 決算関連資料（決算短信 + 発表資料）をフィルタリング
  filterEarningsDocuments(documents: TdnetDocument[]): TdnetDocument[] {
    return documents.filter(
      (doc) => isEarningsSummary(doc.title) || isEarningsPresentation(doc.title)
    );
  }

  // 事業戦略分析に重要な全ドキュメントをフィルタリング
  filterStrategicDocuments(documents: TdnetDocument[]): TdnetDocument[] {
    return documents.filter((doc) => isStrategicDocument(doc.title));
  }

  // 中期経営計画のみフィルタリング
  filterMidTermPlans(documents: TdnetDocument[]): TdnetDocument[] {
    return documents.filter((doc) => isMidTermPlan(doc.title));
  }
}
