// TDnetから新着戦略ドキュメントをチェックしてインポートする
// ※新着はTDnetのみ（IRBANKは遅延があるため履歴用）

import { TdnetClient } from './tdnet';
import { DocumentClassifier, toOldDocumentType } from './documentClassifier';
import {
  createEarningsWithRelease,
  getExistingContentHashes,
  checkUrlExists,
  getOrCreateEarningsRelease,
  getDocumentCountForRelease,
} from '../db/queries';
import { analyzeEarningsRelease } from './earningsAnalyzer';
import { fetchAndStorePdf } from './pdfStorage';
import type { Env, ReleaseType, DocumentType } from '../types';

// DocumentType に変換
function classificationToDocumentType(classType: string): DocumentType | null {
  switch (classType) {
    case 'earnings_summary':
      return 'earnings_summary';
    case 'earnings_presentation':
      return 'earnings_presentation';
    case 'growth_potential':
      return 'growth_potential';
    default:
      return null;
  }
}

// ReleaseType を決定
function determineReleaseType(docType: DocumentType): ReleaseType {
  if (docType === 'growth_potential') {
    return 'growth_potential';
  }
  return 'quarterly_earnings';
}

// 全ウォッチリストユーザーの銘柄をチェック
export async function checkNewReleases(env: Env): Promise<{ checked: number; imported: number }> {
  const client = new TdnetClient();
  const classifier = new DocumentClassifier(env.OPENAI_API_KEY);

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
  // ルールベースで候補を絞る（コスト削減）
  const strategicDocs = client.filterStrategicDocuments(recentDocs);

  console.log(`Found ${strategicDocs.length} recent strategic documents (rule-based)`);

  // 銘柄ごとの既存ハッシュをキャッシュ
  const hashCache = new Map<string, Set<string>>();
  // 分析対象のリリースを追跡
  const releasesToAnalyze = new Map<string, boolean>(); // releaseId -> isNewRelease

  let imported = 0;

  for (const doc of strategicDocs) {
    // 4桁コードに正規化して比較
    const docCode = doc.company_code.slice(0, 4);

    // ウォッチリストにある銘柄かチェック
    const isWatched = stockCodes.some(code => code.slice(0, 4) === docCode);
    if (!isWatched) {
      continue;
    }

    // LLM で分類
    const classification = await classifier.classify(doc.title, doc.pubdate);

    // 対象外ならスキップ
    if (classification.document_type === 'other') {
      console.log(`Skipping by LLM (other): ${doc.title}`);
      continue;
    }

    const fiscalYear = classification.fiscal_year;
    const fiscalQuarter = classification.fiscal_quarter ?? 0;
    const docType = toOldDocumentType(classification.document_type);
    const documentType = classificationToDocumentType(classification.document_type);

    if (!fiscalYear || !documentType) {
      console.log(`Skipping (LLM could not parse or unsupported type): ${doc.title}`);
      continue;
    }

    const stockCode = stockCodes.find(code => code.slice(0, 4) === docCode) || docCode;

    // 既存ハッシュを取得（キャッシュから、なければDB）
    let existingHashes = hashCache.get(stockCode);
    if (!existingHashes) {
      existingHashes = await getExistingContentHashes(env.DB, stockCode);
      hashCache.set(stockCode, existingHashes);
    }

    try {
      // PDF を取得して R2 に保存（重複チェック込み）
      const storedPdf = await fetchAndStorePdf(
        env.PDF_BUCKET,
        doc.document_url,
        stockCode,
        existingHashes,
        (url) => checkUrlExists(env.DB, url)
      );

      if (!storedPdf) {
        continue;
      }

      const announcementDate = doc.pubdate.split(' ')[0];

      // EarningsRelease を取得または作成
      const releaseType = determineReleaseType(documentType);
      const release = await getOrCreateEarningsRelease(env.DB, {
        release_type: releaseType,
        stock_code: stockCode,
        fiscal_year: fiscalYear,
        fiscal_quarter: releaseType === 'growth_potential' ? null : fiscalQuarter,
      });

      // リリースに既にドキュメントがあるか確認（再分析判定用）
      const existingDocCount = await getDocumentCountForRelease(env.DB, release.id);
      const isNewRelease = existingDocCount === 0;

      // Earnings レコードを作成（release_id と document_type 付き）
      await createEarningsWithRelease(env.DB, {
        stock_code: stockCode,
        fiscal_year: fiscalYear,
        fiscal_quarter: fiscalQuarter,
        announcement_date: announcementDate,
        content_hash: storedPdf.contentHash,
        r2_key: storedPdf.r2Key,
        document_url: doc.document_url,
        document_title: doc.title,
        release_id: release.id,
        document_type: documentType,
      });

      existingHashes.add(storedPdf.contentHash);
      imported++;
      console.log(`Imported new [${docType}]: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${doc.title} (confidence: ${classification.confidence.toFixed(2)}, release: ${release.id})`);

      // 分析対象のリリースを記録
      const currentIsNew = releasesToAnalyze.get(release.id);
      if (currentIsNew === undefined) {
        releasesToAnalyze.set(release.id, isNewRelease);
      } else if (currentIsNew && !isNewRelease) {
        releasesToAnalyze.set(release.id, false);
      }
    } catch (error) {
      console.error(`Failed to import ${doc.id}:`, error);
    }
  }

  // リリースごとに分析を実行
  console.log(`Analyzing ${releasesToAnalyze.size} releases...`);
  for (const [releaseId, isNewRelease] of releasesToAnalyze) {
    try {
      const result = await analyzeEarningsRelease(env, releaseId);
      if (result) {
        console.log(
          `Analyzed release ${releaseId}: ${result.customAnalysisCount} custom analyses${isNewRelease ? '' : ' (re-analyzed)'}`
        );
      }
    } catch (error) {
      console.error(`Failed to analyze release ${releaseId}:`, error);
    }
  }

  return { checked: stockCodes.length, imported };
}
