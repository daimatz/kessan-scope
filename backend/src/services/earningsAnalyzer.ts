// 決算分析サービス
// PDFをClaudeで分析し、サマリーとカスタム分析を生成

import { PDFDocument } from 'pdf-lib';
import { ClaudeService } from './claude';
import { getPdfFromR2 } from './pdfStorage';

// Claude APIのページ数上限
const MAX_PDF_PAGES = 100;

// PDFが100ページを超える場合、先頭100ページだけを抽出
async function truncatePdfIfNeeded(pdfBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();

    if (pageCount <= MAX_PDF_PAGES) {
      return pdfBuffer;
    }

    console.log(`Truncating PDF from ${pageCount} to ${MAX_PDF_PAGES} pages`);

    const newPdfDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: MAX_PDF_PAGES }, (_, i) => i);
    const pages = await newPdfDoc.copyPages(pdfDoc, pageIndices);
    pages.forEach(page => newPdfDoc.addPage(page));

    const truncatedBuffer = await newPdfDoc.save();
    return truncatedBuffer.buffer as ArrayBuffer;
  } catch (error) {
    console.error('Failed to truncate PDF:', error);
    return pdfBuffer; // 失敗したら元のバッファを返す
  }
}
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
  getDocumentsForRelease,
  getEarningsReleaseById,
  updateEarningsReleaseAnalysis,
  getUserAnalysisByRelease,
  createUserAnalysisForRelease,
  updateUserAnalysisForRelease,
  saveCustomAnalysisForRelease,
  findCachedAnalysisForRelease,
} from '../db/queries';
import type { Env, Earnings, EarningsSummary, WatchlistItem, CustomAnalysisSummary, DocumentType } from '../types';

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

  // 100ページを超える場合は先頭100ページに切り詰め
  const truncatedBuffer = await truncatePdfIfNeeded(pdfBuffer);

  // 基本サマリーを生成
  console.log('Analyzing PDF with Claude...');
  let summary: EarningsSummary;
  try {
    summary = await claude.analyzeEarningsPdf(truncatedBuffer);
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
        const analysisResult = await claude.analyzeWithCustomPrompt(truncatedBuffer, item.custom_prompt);
        customAnalysis = JSON.stringify(analysisResult);
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
      custom_prompt_used: item.custom_prompt,
    });
  }

  console.log(`Analysis complete: ${customAnalysisCount} custom analyses generated`);

  return { summary, customAnalysisCount };
}

// ドキュメントタイプの優先順位（分析に使用するPDFの優先順位）
const DOCUMENT_TYPE_PRIORITY: DocumentType[] = [
  'earnings_summary',       // 決算短信を最優先
  'earnings_presentation',  // 決算説明資料
  'growth_potential',       // 成長可能性資料
];

// 最大PDF数（Claude APIの制限とコストを考慮）
const MAX_PDFS_PER_ANALYSIS = 2;

// PDFサイズ上限（5MB - 大きすぎるPDFはスキップ）
const MAX_PDF_SIZE = 5 * 1024 * 1024;

// EarningsRelease に対して分析を実行（複数PDF対応）
export async function analyzeEarningsRelease(
  env: Env,
  releaseId: string
): Promise<AnalyzeResult | null> {
  const release = await getEarningsReleaseById(env.DB, releaseId);
  if (!release) {
    console.error('Release not found:', releaseId);
    return null;
  }

  // リリースに紐づくドキュメントを取得
  const documents = await getDocumentsForRelease(env.DB, releaseId);
  if (documents.length === 0) {
    console.error('No documents found for release:', releaseId);
    return null;
  }

  // ドキュメントを優先順位でソート
  const sortedDocs = [...documents].sort((a, b) => {
    const priorityA = DOCUMENT_TYPE_PRIORITY.indexOf(a.document_type as DocumentType);
    const priorityB = DOCUMENT_TYPE_PRIORITY.indexOf(b.document_type as DocumentType);
    return (priorityA === -1 ? 999 : priorityA) - (priorityB === -1 ? 999 : priorityB);
  });

  // 各ドキュメントのPDFを取得（上限まで、サイズ制限あり、タイプ重複なし）
  const pdfDocuments: Array<{ buffer: ArrayBuffer; type: DocumentType }> = [];
  const usedTypes = new Set<DocumentType>();

  for (const doc of sortedDocs) {
    if (pdfDocuments.length >= MAX_PDFS_PER_ANALYSIS) break;
    if (!doc.r2_key || !doc.document_type) continue;

    const docType = doc.document_type as DocumentType;

    // 同じタイプのドキュメントは1つだけ使用
    if (usedTypes.has(docType)) {
      console.log(`Skipping duplicate document type: ${docType}`);
      continue;
    }

    const pdfBuffer = await getPdfFromR2(env.PDF_BUCKET, doc.r2_key);
    if (pdfBuffer) {
      if (pdfBuffer.byteLength > MAX_PDF_SIZE) {
        console.log(`Skipping large PDF (${(pdfBuffer.byteLength / 1024 / 1024).toFixed(1)}MB): ${docType}`);
        continue;
      }
      // 100ページを超える場合は先頭100ページに切り詰め
      const truncatedBuffer = await truncatePdfIfNeeded(pdfBuffer);
      pdfDocuments.push({
        buffer: truncatedBuffer,
        type: docType,
      });
      usedTypes.add(docType);
    }
  }

  if (pdfDocuments.length === 0) {
    console.error('No PDFs available for release:', releaseId);
    return null;
  }

  const claude = new ClaudeService(env.ANTHROPIC_API_KEY);

  // 基本サマリーを生成（複数PDF対応）
  const pdfInfo = pdfDocuments.map(p => `${p.type}(${(p.buffer.byteLength / 1024).toFixed(0)}KB)`).join(', ');
  console.log(`Analyzing ${pdfDocuments.length} PDFs for release ${releaseId}: [${pdfInfo}]`);
  let summary: EarningsSummary | null = null;
  try {
    summary = await claude.analyzeEarningsPdfs(pdfDocuments);
  } catch (error) {
    console.error('Failed to analyze PDFs:', error);

    // 複数PDFで失敗した場合、1つずつ試す
    if (pdfDocuments.length > 1) {
      console.log('Retrying with single PDF...');
      for (const pdfDoc of pdfDocuments) {
        try {
          summary = await claude.analyzeEarningsPdfs([pdfDoc]);
          console.log(`Successfully analyzed with ${pdfDoc.type}`);
          break;
        } catch (retryError) {
          console.error(`Failed to analyze ${pdfDoc.type}:`, retryError);
        }
      }
    }
  }

  // 分析に失敗したら諦める
  if (!summary) {
    console.error('All PDF analysis attempts failed for release:', releaseId);
    return null;
  }

  // サマリーをEarningsReleaseに保存
  await updateEarningsReleaseAnalysis(env.DB, releaseId, {
    summary: JSON.stringify(summary),
    highlights: JSON.stringify(summary.highlights),
    lowlights: JSON.stringify(summary.lowlights),
  });
  console.log('Release summary saved to DB');

  // カスタムプロンプトを持つユーザーの分析を生成
  const watchlistItems = await getWatchlistByStockCode(env.DB, release.stock_code);
  let customAnalysisCount = 0;

  for (const item of watchlistItems) {
    // 既に分析がある場合はスキップ
    const existing = await getUserAnalysisByRelease(env.DB, item.user_id, releaseId);
    if (existing) {
      continue;
    }

    let customAnalysis: string | null = null;

    // カスタムプロンプトがある場合は追加分析
    if (item.custom_prompt) {
      try {
        console.log(`Generating custom analysis for user ${item.user_id}...`);
        const analysisResult = await claude.analyzeWithCustomPromptMultiplePdfs(pdfDocuments, item.custom_prompt);
        customAnalysis = JSON.stringify(analysisResult);
        customAnalysisCount++;
      } catch (error) {
        console.error(`Failed to generate custom analysis for user ${item.user_id}:`, error);
      }
    }

    // ユーザー分析レコードを作成（カスタム分析の有無に関わらず）
    await createUserAnalysisForRelease(env.DB, {
      user_id: item.user_id,
      release_id: releaseId,
      custom_analysis: customAnalysis,
      custom_prompt_used: item.custom_prompt,
    });
  }

  console.log(`Release analysis complete: ${customAnalysisCount} custom analyses generated`);

  return { summary, customAnalysisCount };
}

// 新しいドキュメントが追加された時にリリースを再分析
export async function reanalyzeReleaseWithNewDocument(
  env: Env,
  releaseId: string
): Promise<AnalyzeResult | null> {
  console.log(`Re-analyzing release ${releaseId} with new document...`);
  return analyzeEarningsRelease(env, releaseId);
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

  // 100ページを超える場合は先頭100ページに切り詰め
  const truncatedBuffer = await truncatePdfIfNeeded(pdfBuffer);

  try {
    // カスタム分析を再生成
    console.log(`Regenerating analysis for ${earnings.stock_code} ${earnings.fiscal_year}Q${earnings.fiscal_quarter}...`);
    const analysisResult = await claude.analyzeWithCustomPrompt(truncatedBuffer, customPrompt);
    const newAnalysis = JSON.stringify(analysisResult);

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
