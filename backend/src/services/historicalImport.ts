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
import { MailerSendClient } from './mailersend';
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

// 1ドキュメントを処理（LLM分類済み）
// 戻り値: { imported, hash, releaseId } - releaseId は後で分析用
async function processDocument(
  env: Env,
  stockCode: string,
  doc: ClassifiedDocument,
  existingHashes: Set<string>
): Promise<{ imported: boolean; hash?: string; releaseId?: string; isNewRelease?: boolean }> {
  const { classification } = doc;
  const fiscalYear = classification.fiscal_year;
  const fiscalQuarter = classification.fiscal_quarter ?? 0; // null は 0 に変換
  const documentType = classificationToDocumentType(classification.document_type);

  if (!fiscalYear || !documentType) {
    console.log(`Skipping (LLM could not parse or unsupported type): ${doc.title}`);
    return { imported: false };
  }

  try {
    // PDF を取得して R2 に保存（URL・ハッシュで重複チェック）
    const storedPdf = await fetchAndStorePdf(
      env.PDF_BUCKET,
      doc.pdfUrl,
      stockCode,
      existingHashes,
      (url) => checkUrlExists(env.DB, url)
    );

    if (!storedPdf) {
      return { imported: false };
    }

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
      announcement_date: doc.pubdate,
      content_hash: storedPdf.contentHash,
      r2_key: storedPdf.r2Key,
      document_url: doc.pdfUrl,
      document_title: doc.title,
      file_size: storedPdf.fileSize,
      release_id: release.id,
      document_type: documentType,
    });

    console.log(
      `Imported [${documentType}] from ${doc.source}: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${doc.title} (confidence: ${classification.confidence.toFixed(2)}, release: ${release.id})`
    );

    return { imported: true, hash: storedPdf.contentHash, releaseId: release.id, isNewRelease };
  } catch (error) {
    console.error(`Failed to import from ${doc.source}:`, error);
    return { imported: false };
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

  // 結果を集計し、新しいハッシュを追加
  for (const result of importResults) {
    if (result.imported && result.hash) {
      existingHashes.add(result.hash);
      imported++;

      // 分析対象のリリースを記録
      if (result.releaseId) {
        // isNewRelease が false（既存リリースに追加）の場合は再分析が必要
        const currentIsNew = releasesToAnalyze.get(result.releaseId);
        if (currentIsNew === undefined) {
          releasesToAnalyze.set(result.releaseId, result.isNewRelease ?? true);
        } else if (currentIsNew && result.isNewRelease === false) {
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
    const mailer = new MailerSendClient(
      env.MAILERSEND_API_KEY,
      env.MAILERSEND_FROM_EMAIL
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
