// TDnetから新着決算をチェックしてインポートする
import { TdnetClient, determineFiscalYear, determineFiscalQuarter } from './tdnet';
import { createEarnings, getEarnings } from '../db/queries';
import { analyzeEarningsDocument } from './earningsAnalyzer';
import type { Env } from '../types';

// 全ウォッチリストユーザーの銘柄をチェック
export async function checkNewReleases(env: Env): Promise<{ checked: number; imported: number }> {
  const client = new TdnetClient();

  // ウォッチリストにある全銘柄コードを取得（重複なし）
  const watchlistResult = await env.DB.prepare(`
    SELECT DISTINCT stock_code FROM watchlist
  `).all<{ stock_code: string }>();

  const stockCodes = watchlistResult.results?.map(r => r.stock_code) || [];
  console.log(`Checking ${stockCodes.length} stocks for new releases...`);

  if (stockCodes.length === 0) {
    return { checked: 0, imported: 0 };
  }

  // TDnetの最新開示情報を取得
  const recentDocs = await client.getRecentDocuments(300);
  const earningsDocs = client.filterEarningsSummaries(recentDocs);

  console.log(`Found ${earningsDocs.length} recent earnings summaries`);

  let imported = 0;

  for (const doc of earningsDocs) {
    // 4桁コードに正規化して比較
    const docCode = doc.company_code.slice(0, 4);

    // ウォッチリストにある銘柄かチェック
    const isWatched = stockCodes.some(code => code.slice(0, 4) === docCode);
    if (!isWatched) {
      continue;
    }

    const fiscalYear = determineFiscalYear(doc.title);
    const fiscalQuarter = determineFiscalQuarter(doc.title);

    if (!fiscalYear || fiscalQuarter === 0) {
      console.log(`Skipping (cannot parse): ${doc.title}`);
      continue;
    }

    // 既存データをチェック
    const stockCode = stockCodes.find(code => code.slice(0, 4) === docCode) || docCode;
    const existingEarnings = await getEarnings(env.DB, stockCode);
    const existingKeys = new Set(
      existingEarnings.map((e) => `${e.fiscal_year}-${e.fiscal_quarter}`)
    );

    const key = `${fiscalYear}-${fiscalQuarter}`;
    if (existingKeys.has(key)) {
      continue;
    }

    try {
      const announcementDate = doc.pubdate.split(' ')[0];

      const earnings = await createEarnings(env.DB, {
        stock_code: stockCode,
        fiscal_year: fiscalYear,
        fiscal_quarter: fiscalQuarter,
        announcement_date: announcementDate,
        edinet_doc_id: doc.id,
      });

      imported++;
      console.log(`Imported new release: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${doc.title}`);

      // LLMで分析（PDF取得してサマリー生成）
      const result = await analyzeEarningsDocument(
        env,
        earnings.id,
        stockCode,
        doc.document_url
      );
      if (result) {
        console.log(
          `Analyzed: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${result.customAnalysisCount} custom analyses`
        );
      }
    } catch (error) {
      console.error(`Failed to import ${doc.id}:`, error);
    }
  }

  return { checked: stockCodes.length, imported };
}
