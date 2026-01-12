// TDnetから新着戦略ドキュメントをチェックしてインポートする
// ※新着はTDnetのみ（IRBANKは遅延があるため履歴用）

import { TdnetClient } from './tdnet';
import { DocumentClassifier } from './documentClassifier';
import {
  createEarningsWithRelease,
  getExistingContentHashes,
  checkUrlExists,
  getOrCreateEarningsRelease,
  getDocumentCountForRelease,
  getEarningsReleaseById,
} from '../db/queries';
import { analyzeEarningsRelease, sendNewReleaseNotifications } from './earningsAnalyzer';
import { fetchAndStorePdf } from './pdfStorage';
import { classificationToDocumentType, determineReleaseType } from './documentUtils';
import { syncMarketCapForRelease } from './valuationSync';
import type { Env } from '../types';

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

  // ウォッチリストにある銘柄のみをフィルタ
  const watchedDocs = strategicDocs.filter(doc => {
    const docCode = doc.company_code.slice(0, 4);
    return stockCodes.some(code => code.slice(0, 4) === docCode);
  });

  console.log(`${watchedDocs.length} documents match watched stocks`);

  if (watchedDocs.length === 0) {
    return { checked: stockCodes.length, imported: 0 };
  }

  // LLM でバッチ分類
  const classifications = await classifier.classifyBatch(
    watchedDocs.map(doc => ({ title: doc.title, pubdate: doc.pubdate }))
  );

  // 銘柄ごとの既存ハッシュをキャッシュ
  const hashCache = new Map<string, Set<string>>();
  // 分析対象のリリースを追跡
  const releasesToAnalyze = new Map<string, boolean>(); // releaseId -> isNewRelease

  let imported = 0;

  for (let i = 0; i < watchedDocs.length; i++) {
    const doc = watchedDocs[i];
    const classification = classifications[i];
    const docCode = doc.company_code.slice(0, 4);

    // 対象外ならスキップ
    if (classification.document_type === 'other') {
      console.log(`Skipping by LLM (other): ${doc.title}`);
      continue;
    }

    const fiscalYear = classification.fiscal_year;
    const fiscalQuarter = classification.fiscal_quarter ?? 0;
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
      const fetchResult = await fetchAndStorePdf(
        env.PDF_BUCKET,
        doc.document_url,
        stockCode,
        existingHashes,
        (url) => checkUrlExists(env.DB, url)
      );

      // 取得失敗または既存 → スキップ
      if (fetchResult.type !== 'stored') {
        continue;
      }

      const storedPdf = fetchResult.pdf;
      const announcementDate = doc.pubdate.split(' ')[0];

      // EarningsRelease を取得または作成
      const releaseType = determineReleaseType(documentType);
      const release = await getOrCreateEarningsRelease(env.DB, {
        release_type: releaseType,
        stock_code: stockCode,
        fiscal_year: fiscalYear,
        fiscal_quarter: (releaseType === 'growth_potential' || releaseType === 'mid_term_plan') ? null : fiscalQuarter,
      });

      // リリースに既にドキュメントがあるか確認（再分析判定用）
      const existingDocCount = await getDocumentCountForRelease(env.DB, release.id);
      const isNewRelease = existingDocCount === 0;

      // Earnings レコードを作成（release_id と document_type 付き）
      try {
        await createEarningsWithRelease(env.DB, {
          stock_code: stockCode,
          fiscal_year: fiscalYear,
          fiscal_quarter: fiscalQuarter,
          announcement_date: announcementDate,
          content_hash: storedPdf.contentHash,
          r2_key: storedPdf.r2Key,
          document_url: doc.document_url,
          document_title: doc.title,
          file_size: storedPdf.fileSize,
          release_id: release.id,
          document_type: documentType,
        });
      } catch (insertError) {
        // content_hash の重複は並列処理の競合状態で期待される動作
        const errorMessage = insertError instanceof Error ? insertError.message : String(insertError);
        if (errorMessage.includes('UNIQUE constraint failed: earnings.content_hash')) {
          console.log(`Content already imported (concurrent): ${doc.title}`);
          continue;
        }
        throw insertError;
      }

      existingHashes.add(storedPdf.contentHash);
      imported++;
      console.log(`Imported new [${documentType}]: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${doc.title} (confidence: ${classification.confidence.toFixed(2)}, release: ${release.id})`);

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

  // リリースごとに分析を実行し、通知を送信
  console.log(`Analyzing ${releasesToAnalyze.size} releases...`);
  for (const [releaseId, isNewRelease] of releasesToAnalyze) {
    try {
      const result = await analyzeEarningsRelease(env, releaseId);
      if (result) {
        console.log(
          `Analyzed release ${releaseId}: ${result.customAnalysisCount} custom analyses${isNewRelease ? '' : ' (re-analyzed)'}`
        );
        // 新着決算の通知を送信
        const release = await getEarningsReleaseById(env.DB, releaseId);
        if (release) {
          await sendNewReleaseNotifications(env, release, result.summary);
          // 時価総額を同期
          await syncMarketCapForRelease(env, release);
        }
      }
    } catch (error) {
      console.error(`Failed to analyze release ${releaseId}:`, error);
    }
  }

  return { checked: stockCodes.length, imported };
}
