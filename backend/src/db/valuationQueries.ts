import type { D1Database } from '@cloudflare/workers-types';
import { generateId } from './utils';

export interface StockValuationRow {
  id: string;
  stock_code: string;
  record_date: string;
  fiscal_year: string | null;
  fiscal_quarter: number | null;
  market_cap: number | null;
  revenue: number | null;
  operating_income: number | null;
  net_income: number | null;
  source: string | null;
  created_at: string;
}

// バリュエーションデータを取得（銘柄コード指定）
export async function getValuationsByStockCode(
  db: D1Database,
  stockCode: string
): Promise<StockValuationRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM stock_valuation
       WHERE stock_code = ?
       ORDER BY record_date DESC`
    )
    .bind(stockCode)
    .all<StockValuationRow>();

  return result.results;
}

// バリュエーションデータを保存（upsert）
export async function upsertValuation(
  db: D1Database,
  data: {
    stockCode: string;
    recordDate: string;
    fiscalYear?: string | null;
    fiscalQuarter?: number | null;
    marketCap?: number | null;
    revenue?: number | null;
    operatingIncome?: number | null;
    netIncome?: number | null;
    source?: string;
  }
): Promise<void> {
  const id = generateId();

  await db
    .prepare(
      `INSERT INTO stock_valuation (
        id, stock_code, record_date, fiscal_year, fiscal_quarter,
        market_cap, revenue, operating_income, net_income, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stock_code, fiscal_year, fiscal_quarter)
      DO UPDATE SET
        record_date = COALESCE(excluded.record_date, stock_valuation.record_date),
        market_cap = COALESCE(excluded.market_cap, stock_valuation.market_cap),
        revenue = COALESCE(excluded.revenue, stock_valuation.revenue),
        operating_income = COALESCE(excluded.operating_income, stock_valuation.operating_income),
        net_income = COALESCE(excluded.net_income, stock_valuation.net_income),
        source = COALESCE(excluded.source, stock_valuation.source)`
    )
    .bind(
      id,
      data.stockCode,
      data.recordDate,
      data.fiscalYear ?? null,
      data.fiscalQuarter ?? null,
      data.marketCap ?? null,
      data.revenue ?? null,
      data.operatingIncome ?? null,
      data.netIncome ?? null,
      data.source ?? null
    )
    .run();
}

// 複数のバリュエーションデータを一括保存
export async function batchUpsertValuations(
  db: D1Database,
  valuations: Array<{
    stockCode: string;
    recordDate: string;
    fiscalYear?: string | null;
    fiscalQuarter?: number | null;
    marketCap?: number | null;
    revenue?: number | null;
    operatingIncome?: number | null;
    netIncome?: number | null;
    source?: string;
  }>
): Promise<void> {
  for (const v of valuations) {
    await upsertValuation(db, v);
  }
}

// 決算データから財務指標を抽出してバリュエーションテーブルに保存
export async function syncValuationsFromReleases(
  db: D1Database,
  stockCode: string
): Promise<number> {
  // earnings_release テーブルから summary の keyMetrics を取得
  const releases = await db
    .prepare(
      `SELECT
        er.fiscal_year,
        er.fiscal_quarter,
        er.summary,
        COALESCE(er.announcement_date, e.announcement_date) as announcement_date
       FROM earnings_release er
       LEFT JOIN earnings e ON e.release_id = er.id
       WHERE er.stock_code = ?
       AND er.release_type = 'quarterly_earnings'
       AND er.summary IS NOT NULL
       GROUP BY er.id
       ORDER BY er.fiscal_year DESC, er.fiscal_quarter DESC`
    )
    .bind(stockCode)
    .all<{
      fiscal_year: string;
      fiscal_quarter: number | null;
      summary: string | null;
      announcement_date: string | null;
    }>();

  let count = 0;

  for (const release of releases.results) {
    if (!release.summary) continue;

    try {
      const summary = JSON.parse(release.summary);
      if (!summary.keyMetrics) continue;

      const { revenue, operatingIncome, netIncome } = summary.keyMetrics;

      // 日本語の数値をパース
      const parseJapaneseNumber = (str: string): number | null => {
        if (!str) return null;
        const isNegative = str.includes('△') || str.includes('-') || str.includes('▲');
        const numMatch = str.match(/([\d,]+(?:\.\d+)?)/);
        if (!numMatch) return null;
        let value = parseFloat(numMatch[1].replace(/,/g, ''));
        if (isNaN(value)) return null;
        if (str.includes('兆')) value *= 1000000;
        else if (str.includes('億')) value *= 100;
        else if (str.includes('千万')) value *= 10;
        return isNegative ? -value : value;
      };

      const recordDate = release.announcement_date || `${release.fiscal_year}-12-31`;

      await upsertValuation(db, {
        stockCode,
        recordDate,
        fiscalYear: release.fiscal_year,
        fiscalQuarter: release.fiscal_quarter,
        revenue: parseJapaneseNumber(revenue),
        operatingIncome: parseJapaneseNumber(operatingIncome),
        netIncome: parseJapaneseNumber(netIncome),
        source: 'earnings_release',
      });

      count++;
    } catch {
      // JSONパースエラーは無視
    }
  }

  return count;
}
