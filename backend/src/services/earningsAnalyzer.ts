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
} from '../db/queries';
import type { Env, EarningsSummary } from '../types';

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
