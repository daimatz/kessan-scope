// 決算分析サービス
// PDFをClaudeで分析し、サマリーとカスタム分析を生成

import { ClaudeService } from './claude';
import { getPdfFromR2 } from './pdfStorage';
import {
  updateEarningsAnalysis,
  getWatchlistByStockCode,
  createUserEarningsAnalysis,
  getUserEarningsAnalysis,
  getEarningsById,
  getEarningsByStockCode,
  saveCustomAnalysisToHistory,
  updateUserEarningsAnalysis,
  findCachedAnalysis,
} from '../db/queries';
import type { Env, Earnings, EarningsSummary, WatchlistItem } from '../types';

export interface AnalyzeResult {
  summary: EarningsSummary;
  customAnalysisCount: number;
}

// PDF バッファを直接受け取って分析
export async function analyzeEarningsDocument(
  env: Env,
  earningsId: string,
  pdfBuffer: ArrayBuffer
): Promise<AnalyzeResult | null> {
  const claude = new ClaudeService(env.ANTHROPIC_API_KEY);

  // 基本サマリーを生成
  console.log('Analyzing PDF with Claude...');
  let summary: EarningsSummary;
  try {
    summary = await claude.analyzeEarningsPdf(pdfBuffer);
  } catch (error) {
    console.error('Failed to analyze PDF:', error);
    return null;
  }

  // サマリーをDBに保存
  await updateEarningsAnalysis(env.DB, earningsId, {
    summary: JSON.stringify(summary),
    highlights: JSON.stringify(summary.highlights),
    lowlights: JSON.stringify(summary.lowlights),
  });
  console.log('Summary saved to DB');

  // earnings から stock_code を取得
  const earnings = await getEarningsById(env.DB, earningsId);
  if (!earnings) {
    console.error('Earnings not found:', earningsId);
    return { summary, customAnalysisCount: 0 };
  }

  // カスタムプロンプトを持つユーザーの分析を生成
  const watchlistItems = await getWatchlistByStockCode(env.DB, earnings.stock_code);
  let customAnalysisCount = 0;

  for (const item of watchlistItems) {
    // 既に分析がある場合はスキップ
    const existing = await getUserEarningsAnalysis(env.DB, item.user_id, earningsId);
    if (existing) {
      continue;
    }

    let customAnalysis: string | null = null;

    // カスタムプロンプトがある場合は追加分析
    if (item.custom_prompt) {
      try {
        console.log(`Generating custom analysis for user ${item.user_id}...`);
        customAnalysis = await claude.analyzeWithCustomPrompt(pdfBuffer, item.custom_prompt);
        customAnalysisCount++;
      } catch (error) {
        console.error(`Failed to generate custom analysis for user ${item.user_id}:`, error);
      }
    }

    // ユーザー分析レコードを作成（カスタム分析の有無に関わらず）
    await createUserEarningsAnalysis(env.DB, {
      user_id: item.user_id,
      earnings_id: earningsId,
      custom_analysis: customAnalysis,
    });
  }

  console.log(`Analysis complete: ${customAnalysisCount} custom analyses generated`);

  return { summary, customAnalysisCount };
}

// R2 から PDF を取得して分析（再分析用）
export async function reanalyzeFromR2(
  env: Env,
  earningsId: string
): Promise<AnalyzeResult | null> {
  const earnings = await getEarningsById(env.DB, earningsId);
  if (!earnings || !earnings.r2_key) {
    console.error('Earnings or R2 key not found:', earningsId);
    return null;
  }

  const pdfBuffer = await getPdfFromR2(env.PDF_BUCKET, earnings.r2_key);
  if (!pdfBuffer) {
    console.error('PDF not found in R2:', earnings.r2_key);
    return null;
  }

  return analyzeEarningsDocument(env, earningsId, pdfBuffer);
}

export interface RegenerateResult {
  total: number;
  regenerated: number;
  cached: number;
  skipped: number;
}

const REGENERATE_PARALLEL_LIMIT = 3;

// 1ドキュメントの再分析処理
// 戻り値: 'regenerated' | 'cached' | 'skipped'
async function regenerateOneDocument(
  env: Env,
  claude: ClaudeService,
  earnings: Earnings,
  userId: string,
  customPrompt: string
): Promise<'regenerated' | 'cached' | 'skipped'> {
  // R2 キーがない場合はスキップ
  if (!earnings.r2_key) {
    return 'skipped';
  }

  // 現在の分析を取得
  const currentAnalysis = await getUserEarningsAnalysis(env.DB, userId, earnings.id);

  // 同じプロンプトで既に分析済みならスキップ（キャッシュヒット）
  if (currentAnalysis?.custom_prompt_used === customPrompt && currentAnalysis?.custom_analysis) {
    console.log(`Cache hit: ${earnings.stock_code} ${earnings.fiscal_year}Q${earnings.fiscal_quarter}`);
    return 'cached';
  }

  // 履歴から同じプロンプトでの分析を検索
  const cachedAnalysis = await findCachedAnalysis(env.DB, userId, earnings.id, customPrompt);
  if (cachedAnalysis) {
    console.log(`History cache hit: ${earnings.stock_code} ${earnings.fiscal_year}Q${earnings.fiscal_quarter}`);

    // 現在の分析を履歴に保存（あれば）
    if (currentAnalysis?.custom_analysis && currentAnalysis.custom_prompt_used) {
      await saveCustomAnalysisToHistory(
        env.DB,
        userId,
        earnings.id,
        currentAnalysis.custom_prompt_used,
        currentAnalysis.custom_analysis
      );
    }

    // キャッシュされた分析を現在の分析として設定
    if (currentAnalysis) {
      await updateUserEarningsAnalysis(env.DB, userId, earnings.id, cachedAnalysis, customPrompt);
    } else {
      await createUserEarningsAnalysis(env.DB, {
        user_id: userId,
        earnings_id: earnings.id,
        custom_analysis: cachedAnalysis,
        custom_prompt_used: customPrompt,
      });
    }
    return 'cached';
  }

  // 既存の分析がある場合は履歴に保存
  if (currentAnalysis?.custom_analysis && currentAnalysis.custom_prompt_used) {
    await saveCustomAnalysisToHistory(
      env.DB,
      userId,
      earnings.id,
      currentAnalysis.custom_prompt_used,
      currentAnalysis.custom_analysis
    );
  }

  // R2 から PDF を取得
  const pdfBuffer = await getPdfFromR2(env.PDF_BUCKET, earnings.r2_key);
  if (!pdfBuffer) {
    console.error(`PDF not found in R2: ${earnings.r2_key}`);
    return 'skipped';
  }

  try {
    // カスタム分析を再生成
    console.log(`Regenerating analysis for ${earnings.stock_code} ${earnings.fiscal_year}Q${earnings.fiscal_quarter}...`);
    const newAnalysis = await claude.analyzeWithCustomPrompt(pdfBuffer, customPrompt);

    if (currentAnalysis) {
      // 既存レコードを更新
      await updateUserEarningsAnalysis(env.DB, userId, earnings.id, newAnalysis, customPrompt);
    } else {
      // 新規レコード作成
      await createUserEarningsAnalysis(env.DB, {
        user_id: userId,
        earnings_id: earnings.id,
        custom_analysis: newAnalysis,
        custom_prompt_used: customPrompt,
      });
    }

    return 'regenerated';
  } catch (error) {
    console.error(`Failed to regenerate analysis for ${earnings.id}:`, error);
    return 'skipped';
  }
}

// ウォッチリストアイテムのカスタム分析を再生成（3並列）
export async function regenerateCustomAnalysis(
  env: Env,
  watchlistItem: WatchlistItem
): Promise<RegenerateResult> {
  const { user_id: userId, stock_code: stockCode, custom_prompt: customPrompt } = watchlistItem;

  if (!customPrompt) {
    return { total: 0, regenerated: 0, cached: 0, skipped: 0 };
  }

  const claude = new ClaudeService(env.ANTHROPIC_API_KEY);
  const allEarnings = await getEarningsByStockCode(env.DB, stockCode);

  let regenerated = 0;
  let cached = 0;
  let skipped = 0;

  // 3並列で処理
  for (let i = 0; i < allEarnings.length; i += REGENERATE_PARALLEL_LIMIT) {
    const batch = allEarnings.slice(i, i + REGENERATE_PARALLEL_LIMIT);

    const results = await Promise.all(
      batch.map(earnings => regenerateOneDocument(env, claude, earnings, userId, customPrompt))
    );

    for (const result of results) {
      switch (result) {
        case 'regenerated':
          regenerated++;
          break;
        case 'cached':
          cached++;
          break;
        case 'skipped':
          skipped++;
          break;
      }
    }
  }

  console.log(`Regeneration complete: ${regenerated} regenerated, ${cached} cached, ${skipped} skipped (total: ${allEarnings.length})`);

  return {
    total: allEarnings.length,
    regenerated,
    cached,
    skipped,
  };
}
