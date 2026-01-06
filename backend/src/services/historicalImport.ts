import pLimit from 'p-limit';
import {
  getDocumentCandidates,
  classifyDocuments,
  ClassifiedDocument,
} from './documentSources';
import {
  createEarningsWithRelease,
  getExistingContentHashes,
  checkUrlExists,
  getOrCreateEarningsRelease,
  getDocumentCountForRelease,
} from '../db/queries';
import { analyzeEarningsRelease } from './earningsAnalyzer';
import { fetchAndStorePdf } from './pdfStorage';
import { MailgunClient } from './mailgun';
import { classificationToDocumentType, determineReleaseType } from './documentUtils';
import { PARALLEL_LIMIT } from '../constants';
import type { Env, ImportQueueMessage } from '../types';

const limit = pLimit(PARALLEL_LIMIT);

// ウォッチリスト追加時に呼び出す：Queueにメッセージを送信
export async function enqueueHistoricalImport(
  queue: Queue<ImportQueueMessage>,
  stockCode: string,
  stockName: string | null,
  userId: string,
  userEmail: string
): Promise<void> {
  const message: ImportQueueMessage = {
    type: 'import_historical_earnings',
    stockCode,
    stockName,
    userId,
    userEmail,
  };

  await queue.send(message);
  console.log(`Enqueued historical import for ${stockCode}`);
}

// processDocument の結果
// - status: 'imported' = ユーザーにとってデータが利用可能（新規作成 or 既存）
// - status: 'skipped' = 対象外（LLM判定、PDF取得失敗）
type ProcessDocumentResult =
  | { status: 'imported'; newlyCreated: true; hash: string; releaseId: string; isNewRelease: boolean }
  | { status: 'imported'; newlyCreated: false }
  | { status: 'skipped' };

// 1ドキュメントを処理（LLM分類済み）
async function processDocument(
  env: Env,
  stockCode: string,
  doc: ClassifiedDocument,
  existingHashes: Set<string>
): Promise<ProcessDocumentResult> {
  const { classification } = doc;
  const fiscalYear = classification.fiscal_year;
  const fiscalQuarter = classification.fiscal_quarter ?? 0; // null は 0 に変換
  const documentType = classificationToDocumentType(classification.document_type);

  if (!fiscalYear || !documentType) {
    console.log(`Skipping (LLM could not parse or unsupported type): ${doc.title}`);
    return { status: 'skipped' };
  }

  try {
    // PDF を取得して R2 に保存（URL・ハッシュで重複チェック）
    const fetchResult = await fetchAndStorePdf(
      env.PDF_BUCKET,
      doc.pdfUrl,
      stockCode,
      existingHashes,
      (url) => checkUrlExists(env.DB, url)
    );

    // 取得失敗 → スキップ
    if (fetchResult.type === 'failed') {
      return { status: 'skipped' };
    }

    // 既存データ → インポート済み扱い（ユーザーにとってはデータが利用可能）
    if (fetchResult.type === 'existing') {
      return { status: 'imported', newlyCreated: false };
    }

    const storedPdf = fetchResult.pdf;

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
        announcement_date: doc.pubdate,
        content_hash: storedPdf.contentHash,
        r2_key: storedPdf.r2Key,
        document_url: doc.pdfUrl,
        document_title: doc.title,
        file_size: storedPdf.fileSize,
        release_id: release.id,
        document_type: documentType,
      });
    } catch (insertError) {
      // content_hash の重複は並列処理の競合状態で期待される動作
      // 他のユーザーが同じ会社の決算を同時にインポートした場合に発生する
      const errorMessage = insertError instanceof Error ? insertError.message : String(insertError);
      if (errorMessage.includes('UNIQUE constraint failed: earnings.content_hash')) {
        console.log(`Content already imported (concurrent): ${doc.title}`);
        // ユーザーにとってはデータが利用可能なので imported 扱い
        return { status: 'imported', newlyCreated: false };
      }
      throw insertError;
    }

    console.log(
      `Imported [${documentType}] from ${doc.source}: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${doc.title} (confidence: ${classification.confidence.toFixed(2)}, release: ${release.id})`
    );

    return { status: 'imported', newlyCreated: true, hash: storedPdf.contentHash, releaseId: release.id, isNewRelease };
  } catch (error) {
    console.error(`Failed to import from ${doc.source}:`, error);
    return { status: 'skipped' };
  }
}

// Queue Consumerで呼び出す：TDnet + IRBANK から決算データをインポート
export async function processImportBatch(
  env: Env,
  message: ImportQueueMessage
): Promise<void> {
  const { stockCode, stockName, userId, userEmail } = message;

  console.log(`Importing earnings for ${stockCode}...`);

  // 既存の content_hash を取得（重複防止）
  const existingHashes = await getExistingContentHashes(env.DB, stockCode);
  console.log(`Found ${existingHashes.size} existing documents`);

  // TDnet + IRBANK からドキュメント候補を取得
  const candidates = await getDocumentCandidates(stockCode);
  console.log(`Found ${candidates.length} candidates (pre-filtered by rule-based)`);

  // LLM で分類・フィルタリング
  console.log(`Classifying documents with LLM...`);
  const classifiedDocs = await classifyDocuments(candidates, env.OPENAI_API_KEY);
  console.log(`${classifiedDocs.length} documents classified as target`);

  let imported = 0;
  let skipped = 0;
  const releasesToAnalyze = new Map<string, boolean>(); // releaseId -> isNewRelease

  // p-limit で並列処理（常に PARALLEL_LIMIT 並列を維持）
  const importResults = await Promise.all(
    classifiedDocs.map(doc =>
      limit(() => processDocument(env, stockCode, doc, existingHashes))
    )
  );

  // 結果を集計
  for (const result of importResults) {
    if (result.status === 'imported') {
      imported++;

      // 新規作成の場合のみ、ハッシュ追加と分析対象の記録
      if (result.newlyCreated) {
        existingHashes.add(result.hash);

        // 分析対象のリリースを記録
        const currentIsNew = releasesToAnalyze.get(result.releaseId);
        if (currentIsNew === undefined) {
          releasesToAnalyze.set(result.releaseId, result.isNewRelease);
        } else if (currentIsNew && !result.isNewRelease) {
          // 新規だったが後から追加ドキュメントが来た場合
          releasesToAnalyze.set(result.releaseId, false);
        }
      }
    } else {
      skipped++;
    }
  }

  console.log(
    `Import complete for ${stockCode}: ${imported} imported, ${skipped} skipped`
  );

  // リリースごとに分析を実行（p-limit で並列処理）
  // 初回インポート時は個別通知を送らない（最後に完了通知のみ送信）
  console.log(`Analyzing ${releasesToAnalyze.size} releases...`);
  await Promise.all(
    Array.from(releasesToAnalyze.entries()).map(([releaseId, isNewRelease]) =>
      limit(async () => {
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
      })
    )
  );

  // 完了通知メールを送信
  try {
    const mailer = new MailgunClient(
      env.MAILGUN_API_KEY,
      env.MAILGUN_DOMAIN,
      env.MAILGUN_FROM_EMAIL
    );
    await mailer.sendImportCompleteEmail({
      to: { email: userEmail },
      stockCode,
      stockName,
      imported,
      skipped,
      dashboardUrl: `${env.FRONTEND_URL}/stocks/${stockCode}`,
    });
    console.log(`Import completion email sent to ${userEmail}`);
  } catch (error) {
    console.error('Failed to send import completion email:', error);
  }
}
