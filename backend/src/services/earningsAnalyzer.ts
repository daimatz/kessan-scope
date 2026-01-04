// 決算分析サービス
// PDFをClaudeで分析し、サマリーとカスタム分析を生成

import pLimit from 'p-limit';
import { PDFDocument } from 'pdf-lib';
import { ClaudeService } from './claude';
import { getPdfFromR2 } from './pdfStorage';
import type { Env, EarningsRelease, EarningsSummary, WatchlistItem, DocumentType } from '../types';
import {
  getWatchlistItemsWithoutAnalysis,
  getDocumentsForRelease,
  getEarningsReleaseById,
  getEarningsReleasesByStockCode,
  updateEarningsReleaseAnalysis,
  getUserAnalysisByRelease,
  createUserAnalysisForRelease,
  updateUserAnalysisForRelease,
  saveCustomAnalysisForRelease,
  findCachedAnalysisForRelease,
} from '../db/queries';
import {
  PARALLEL_LIMIT,
  MAX_PDF_PAGES,
  MAX_PDF_SIZE,
  MAX_PDFS_PER_TYPE,
} from '../constants';

const limit = pLimit(PARALLEL_LIMIT);

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

    const truncatedBytes = await newPdfDoc.save();
    // Uint8Array.buffer は元のバッファ全体を参照する可能性があるため、
    // 新しいArrayBufferにコピーする
    const newBuffer = new ArrayBuffer(truncatedBytes.length);
    new Uint8Array(newBuffer).set(truncatedBytes);
    return newBuffer;
  } catch (error) {
    console.error('Failed to truncate PDF:', error);
    return pdfBuffer; // 失敗したら元のバッファを返す
  }
}

export interface AnalyzeResult {
  summary: EarningsSummary;
  customAnalysisCount: number;
}

// ドキュメントタイプの優先順位（分析に使用するPDFの優先順位）
const DOCUMENT_TYPE_PRIORITY: DocumentType[] = [
  'earnings_summary',       // 決算短信を最優先
  'earnings_presentation',  // 決算説明資料
  'growth_potential',       // 成長可能性資料
];

// リリースからPDFドキュメントを取得するヘルパー
// 各ドキュメントタイプごとにファイルサイズ順で上位N件を選択
async function getPdfDocumentsForRelease(
  env: Env,
  releaseId: string
): Promise<Array<{ buffer: ArrayBuffer; type: DocumentType }>> {
  // リリースに紐づくドキュメントを取得
  const documents = await getDocumentsForRelease(env.DB, releaseId);
  if (documents.length === 0) {
    return [];
  }

  // r2_keyがあるドキュメントのみ対象
  const docsWithR2Key = documents.filter((doc) => doc.r2_key !== null);

  // ドキュメントタイプごとにグループ化
  const docsByType = new Map<DocumentType, typeof docsWithR2Key>();
  for (const doc of docsWithR2Key) {
    const type = doc.document_type as DocumentType;
    if (!docsByType.has(type)) {
      docsByType.set(type, []);
    }
    docsByType.get(type)!.push(doc);
  }

  // 各タイプ内でファイルサイズ順（大きい順）にソートし、上位N件を選択
  const targetDocs: typeof docsWithR2Key = [];
  for (const type of DOCUMENT_TYPE_PRIORITY) {
    const docsOfType = docsByType.get(type);
    if (!docsOfType) continue;

    // ファイルサイズ降順でソート（nullは0として扱う）
    const sorted = [...docsOfType].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0));
    // 上位N件を追加
    targetDocs.push(...sorted.slice(0, MAX_PDFS_PER_TYPE));
  }

  // PDFを取得（並列）
  const pdfResults = await Promise.all(
    targetDocs.map(async (doc) => {
      try {
        const pdfBuffer = await getPdfFromR2(env.PDF_BUCKET, doc.r2_key!);
        if (!pdfBuffer) {
          console.error(`PDF not found in R2: ${doc.r2_key}`);
          return null;
        }

        // サイズチェック（32MB超は除外）
        if (pdfBuffer.byteLength > MAX_PDF_SIZE) {
          console.log(`PDF too large (${(pdfBuffer.byteLength / 1024 / 1024).toFixed(1)}MB), skipping: ${doc.r2_key}`);
          return null;
        }

        // ページ数制限（100ページ超は切り詰め）
        const truncatedBuffer = await truncatePdfIfNeeded(pdfBuffer);

        return {
          buffer: truncatedBuffer,
          type: doc.document_type as DocumentType,
        };
      } catch (error) {
        console.error(`Failed to fetch PDF ${doc.r2_key}:`, error);
        return null;
      }
    })
  );

  // null を除外
  return pdfResults.filter((r): r is { buffer: ArrayBuffer; type: DocumentType } => r !== null);
}

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

  // PDFドキュメントを取得（共通ヘルパー使用）
  const pdfDocuments = await getPdfDocumentsForRelease(env, releaseId);
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

  // カスタムプロンプトを持つユーザーの分析を生成（p-limit で並列処理）
  // SQL側で既存の分析がないユーザーのみをフィルタリング
  const itemsToProcess = await getWatchlistItemsWithoutAnalysis(env.DB, release.stock_code, releaseId);
  let customAnalysisCount = 0;

  // p-limit で並列処理（常に PARALLEL_LIMIT 並列を維持）
  const results = await Promise.all(
    itemsToProcess.map(item =>
      limit(async () => {
        let customAnalysis: string | null = null;

        // カスタムプロンプトがある場合は追加分析
        if (item.custom_prompt) {
          try {
            console.log(`Generating custom analysis for user ${item.user_id}...`);
            const analysisResult = await claude.analyzeWithCustomPromptMultiplePdfs(pdfDocuments, item.custom_prompt);
            customAnalysis = JSON.stringify(analysisResult);
            return { item, customAnalysis, success: true };
          } catch (error) {
            console.error(`Failed to generate custom analysis for user ${item.user_id}:`, error);
            return { item, customAnalysis: null, success: false };
          }
        }
        return { item, customAnalysis, success: true };
      })
    )
  );

  // DB保存は逐次（D1の制限を考慮）
  for (const { item, customAnalysis, success } of results) {
    if (success && customAnalysis) {
      customAnalysisCount++;
    }
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

export interface RegenerateResult {
  total: number;
  regenerated: number;
  cached: number;
  skipped: number;
}

// 1リリースの再分析処理
// 戻り値: 'regenerated' | 'cached' | 'skipped'
async function regenerateOneRelease(
  env: Env,
  claude: ClaudeService,
  release: EarningsRelease,
  userId: string,
  customPrompt: string
): Promise<'regenerated' | 'cached' | 'skipped'> {
  // 現在の分析を取得
  const currentAnalysis = await getUserAnalysisByRelease(env.DB, userId, release.id);

  // 同じプロンプトで既に分析済みならスキップ（キャッシュヒット）
  if (currentAnalysis?.custom_prompt_used === customPrompt && currentAnalysis?.custom_analysis) {
    const quarterStr = release.fiscal_quarter ? `Q${release.fiscal_quarter}` : '';
    console.log(`Cache hit: ${release.stock_code} ${release.fiscal_year}${quarterStr}`);
    return 'cached';
  }

  // 履歴から同じプロンプトでの分析を検索
  const cachedAnalysis = await findCachedAnalysisForRelease(env.DB, userId, release.id, customPrompt);
  if (cachedAnalysis) {
    const quarterStr = release.fiscal_quarter ? `Q${release.fiscal_quarter}` : '';
    console.log(`History cache hit: ${release.stock_code} ${release.fiscal_year}${quarterStr}`);

    // 現在の分析を履歴に保存（あれば）
    if (currentAnalysis?.custom_analysis && currentAnalysis.custom_prompt_used) {
      await saveCustomAnalysisForRelease(
        env.DB,
        userId,
        release.id,
        currentAnalysis.custom_prompt_used,
        currentAnalysis.custom_analysis
      );
    }

    // キャッシュされた分析を現在の分析として設定
    if (currentAnalysis) {
      await updateUserAnalysisForRelease(env.DB, userId, release.id, cachedAnalysis, customPrompt);
    } else {
      await createUserAnalysisForRelease(env.DB, {
        user_id: userId,
        release_id: release.id,
        custom_analysis: cachedAnalysis,
        custom_prompt_used: customPrompt,
      });
    }
    return 'cached';
  }

  // 既存の分析がある場合は履歴に保存
  if (currentAnalysis?.custom_analysis && currentAnalysis.custom_prompt_used) {
    await saveCustomAnalysisForRelease(
      env.DB,
      userId,
      release.id,
      currentAnalysis.custom_prompt_used,
      currentAnalysis.custom_analysis
    );
  }

  // リリースに紐づくPDFを取得
  const pdfDocuments = await getPdfDocumentsForRelease(env, release.id);
  if (pdfDocuments.length === 0) {
    console.log(`No PDFs available for release: ${release.id}`);
    return 'skipped';
  }

  try {
    // カスタム分析を再生成
    const quarterStr = release.fiscal_quarter ? `Q${release.fiscal_quarter}` : '';
    console.log(`Regenerating analysis for ${release.stock_code} ${release.fiscal_year}${quarterStr}...`);
    const analysisResult = await claude.analyzeWithCustomPromptMultiplePdfs(pdfDocuments, customPrompt);
    const newAnalysis = JSON.stringify(analysisResult);

    if (currentAnalysis) {
      // 既存レコードを更新
      await updateUserAnalysisForRelease(env.DB, userId, release.id, newAnalysis, customPrompt);
    } else {
      // 新規レコード作成
      await createUserAnalysisForRelease(env.DB, {
        user_id: userId,
        release_id: release.id,
        custom_analysis: newAnalysis,
        custom_prompt_used: customPrompt,
      });
    }

    return 'regenerated';
  } catch (error) {
    console.error(`Failed to regenerate analysis for release ${release.id}:`, error);
    return 'skipped';
  }
}

// ウォッチリストアイテムのカスタム分析を再生成（p-limit で並列処理）
export async function regenerateCustomAnalysis(
  env: Env,
  watchlistItem: WatchlistItem
): Promise<RegenerateResult> {
  const { user_id: userId, stock_code: stockCode, custom_prompt: customPrompt } = watchlistItem;

  if (!customPrompt) {
    return { total: 0, regenerated: 0, cached: 0, skipped: 0 };
  }

  const claude = new ClaudeService(env.ANTHROPIC_API_KEY);
  const allReleases = await getEarningsReleasesByStockCode(env.DB, stockCode);

  // p-limit で並列処理（常に PARALLEL_LIMIT 並列を維持）
  const results = await Promise.all(
    allReleases.map(release =>
      limit(() => regenerateOneRelease(env, claude, release, userId, customPrompt))
    )
  );

  let regenerated = 0;
  let cached = 0;
  let skipped = 0;

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

  console.log(`Regeneration complete: ${regenerated} regenerated, ${cached} cached, ${skipped} skipped (total: ${allReleases.length})`);

  return {
    total: allReleases.length,
    regenerated,
    cached,
    skipped,
  };
}
