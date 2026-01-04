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
  // 子会社の決算は対象外
  if (title.includes('子会社') && title.includes('決算')) {
    return false;
  }

  // 「四半期決算」は決算短信以外のみ対象
  if (title.includes('四半期決算') && !title.includes('決算短信')) {
    return true;
  }

  return (
    title.includes('決算説明') ||
    title.includes('決算報告') ||
    title.includes('決算補足') ||
    title.includes('決算参考') ||
    title.includes('決算について') ||
    title.includes('決算を発表') ||
    title.includes('説明会資料') ||
    title.includes('プレゼンテーション資料') ||
    title.includes('決算資料') ||
    title.includes('業績説明') ||
    title.includes('投資家説明') ||
    title.includes('投資家向け説明') ||
    title.includes('決算プレゼン') ||
    title.includes('説明資料') ||
    title.includes('決算概要') ||
    title.includes('業績概要') ||
    title.includes('決算ハイライト') ||
    title.includes('連結決算') ||
    title.includes('IR資料') ||
    title.includes('Earnings') ||
    title.includes('Financial Results') ||
    title.includes('Presentation') ||
    title.includes('Fact Sheet')
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

  // 「1Q」「Q1」「第1四半期」などのパターン
  if (/[^0-9]1Q|Q1[^0-9]|第1四半期|第１四半期/i.test(title)) return 1;
  if (/[^0-9]2Q|Q2[^0-9]|第2四半期|第２四半期|中間|上期/i.test(title)) return 2;
  if (/[^0-9]3Q|Q3[^0-9]|第3四半期|第３四半期/i.test(title)) return 3;
  if (/[^0-9]4Q|Q4[^0-9]|第4四半期|第４四半期|通期|期末|FullYear|Full Year|Annual/i.test(title)) return 4;

  // 「四半期」「中間」「上期」を含まない決算短信・説明資料は通期(Q4)
  if ((isEarningsSummary(title) || isEarningsPresentation(title)) && !title.includes('四半期') && !title.includes('中間') && !title.includes('上期')) {
    return 4;
  }

  return 0;
}

// 和暦から西暦に変換
function convertJapaneseEraToYear(era: string, year: number): number {
  switch (era) {
    case '令和': return 2018 + year;  // 令和元年 = 2019年
    case '平成': return 1988 + year;  // 平成元年 = 1989年
    case '昭和': return 1925 + year;  // 昭和元年 = 1926年
    default: return year;
  }
}

// 年度を判定（タイトルまたは発表日から）
export function determineFiscalYear(title: string, pubdate?: string): string {
  // "FY2026.6" or "FY2026" パターン（英語表記）
  // FY2026.6 = 2026年6月期 = 2025年度
  const fyMatch = title.match(/FY\s*(\d{4})(?:\.(\d{1,2}))?/i);
  if (fyMatch) {
    const year = parseInt(fyMatch[1], 10);
    return String(year - 1);
  }

  // "2026年3月期" 西暦パターン
  const jpMatch = title.match(/(\d{4})年\d{1,2}月期/);
  if (jpMatch) {
    return String(parseInt(jpMatch[1], 10) - 1);
  }

  // "平成26年3月期" or "令和6年3月期" 和暦パターン
  // "平成28年度3月期" のような変則パターンも対応
  const eraMatch = title.match(/(令和|平成|昭和)(\d{1,2})年度?\d{1,2}月期/);
  if (eraMatch) {
    const westernYear = convertJapaneseEraToYear(eraMatch[1], parseInt(eraMatch[2], 10));
    return String(westernYear - 1);
  }

  // "2025年度" パターン（そのまま使用）
  // "2025度" のような「年」が省略されたパターンも対応
  const nendoMatch = title.match(/(\d{4})年?度/);
  if (nendoMatch) {
    return nendoMatch[1];
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

    const text = await response.text();
    try {
      const data = JSON.parse(text) as TdnetApiResponse;
      return data.items.map((item) => item.Tdnet);
    } catch {
      // TDnet may return non-JSON response for unsupported stock codes
      throw new Error(`TDnet returned invalid response for ${code}: ${text.slice(0, 100)}`);
    }
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
