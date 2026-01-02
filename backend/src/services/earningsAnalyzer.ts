// 決算分析サービス
// PDFをClaudeで分析し、サマリーとカスタム分析を生成

import { ClaudeService } from './claude';
import {
  updateEarningsAnalysis,
  getWatchlistByStockCode,
  createUserEarningsAnalysis,
  getUserEarningsAnalysis,
} from '../db/queries';
import type { Env, EarningsSummary } from '../types';

export interface AnalyzeResult {
  summary: EarningsSummary;
  customAnalysisCount: number;
}

export async function analyzeEarningsDocument(
  env: Env,
  earningsId: string,
  stockCode: string,
  documentUrl: string
): Promise<AnalyzeResult | null> {
  const claude = new ClaudeService(env.ANTHROPIC_API_KEY);

  // PDFを取得
  console.log(`Fetching PDF from ${documentUrl}...`);
  const pdfResponse = await fetch(documentUrl);
  if (!pdfResponse.ok) {
    console.error(`Failed to fetch PDF: ${pdfResponse.status}`);
    return null;
  }
  const pdfBuffer = await pdfResponse.arrayBuffer();
  console.log(`PDF fetched: ${pdfBuffer.byteLength} bytes`);

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

  // カスタムプロンプトを持つユーザーの分析を生成
  const watchlistItems = await getWatchlistByStockCode(env.DB, stockCode);
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
