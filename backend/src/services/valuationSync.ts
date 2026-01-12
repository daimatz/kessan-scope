// 決算インポート時に時価総額を同期するサービス

import { ValuationFetcher } from './valuationFetcher';
import { upsertValuation, syncValuationsFromReleases } from '../db/valuationQueries';
import type { Env } from '../types';
import type { EarningsRelease } from '../types';

// 特定のリリースに対して時価総額を同期
export async function syncMarketCapForRelease(
  env: Env,
  release: EarningsRelease
): Promise<boolean> {
  if (!release.announcement_date || release.fiscal_quarter === null) {
    console.log(`Skipping market cap sync for release ${release.id}: no announcement_date or fiscal_quarter`);
    return false;
  }

  const fetcher = new ValuationFetcher();

  try {
    // 発表日時点の時価総額を取得
    const marketCap = await fetcher.fetchMarketCapAtDate(
      release.stock_code,
      release.announcement_date
    );

    if (marketCap === null) {
      console.log(`No market cap found for ${release.stock_code} at ${release.announcement_date}`);
      return false;
    }

    // DBに保存
    await upsertValuation(env.DB, {
      stockCode: release.stock_code,
      recordDate: release.announcement_date,
      fiscalYear: release.fiscal_year,
      fiscalQuarter: release.fiscal_quarter,
      marketCap: marketCap,
      source: 'irbank',
    });

    console.log(`Synced market cap for ${release.stock_code} ${release.fiscal_year}Q${release.fiscal_quarter}: ${marketCap}`);
    return true;
  } catch (error) {
    console.error(`Failed to sync market cap for release ${release.id}:`, error);
    return false;
  }
}

// 銘柄の全リリースに対して時価総額を同期（バッチ処理用）
export async function syncAllMarketCapsForStock(
  env: Env,
  stockCode: string
): Promise<{ earnings: number; marketCap: number }> {
  let earningsCount = 0;
  let marketCapCount = 0;

  // 売上高・営業利益を決算データから同期
  try {
    earningsCount = await syncValuationsFromReleases(env.DB, stockCode);
    console.log(`Synced ${earningsCount} earnings records for ${stockCode}`);
  } catch (error) {
    console.error('Failed to sync earnings:', error);
  }

  // 決算発表済みの四半期を取得
  const releases = await env.DB
    .prepare(
      `SELECT id, stock_code, fiscal_year, fiscal_quarter, announcement_date
       FROM earnings_release
       WHERE stock_code = ?
       AND release_type = 'quarterly_earnings'
       AND fiscal_quarter IS NOT NULL
       AND announcement_date IS NOT NULL
       ORDER BY fiscal_year, fiscal_quarter`
    )
    .bind(stockCode)
    .all<EarningsRelease>();

  // 各リリースの時価総額を同期
  for (const release of releases.results) {
    const success = await syncMarketCapForRelease(env, release);
    if (success) marketCapCount++;
  }

  return { earnings: earningsCount, marketCap: marketCapCount };
}
