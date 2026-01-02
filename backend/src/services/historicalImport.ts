import {
  getDocumentCandidates,
  classifyDocuments,
  ClassifiedDocument,
  toOldDocumentType,
} from './documentSources';
import { createEarnings, getExistingContentHashes, checkUrlExists } from '../db/queries';
import { analyzeEarningsDocument } from './earningsAnalyzer';
import { fetchAndStorePdf } from './pdfStorage';
import { MailerSendClient } from './mailersend';
import type { Env, ImportQueueMessage } from '../types';

const PARALLEL_LIMIT = 3;

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
async function processDocument(
  env: Env,
  stockCode: string,
  doc: ClassifiedDocument,
  existingHashes: Set<string>
): Promise<{ imported: boolean; hash?: string }> {
  const { classification } = doc;
  const fiscalYear = classification.fiscal_year;
  const fiscalQuarter = classification.fiscal_quarter ?? 0; // null は 0 に変換
  const docType = toOldDocumentType(classification.document_type);

  if (!fiscalYear) {
    console.log(`Skipping (LLM could not parse year): ${doc.title}`);
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

    const earnings = await createEarnings(env.DB, {
      stock_code: stockCode,
      fiscal_year: fiscalYear,
      fiscal_quarter: fiscalQuarter,
      announcement_date: doc.pubdate,
      content_hash: storedPdf.contentHash,
      r2_key: storedPdf.r2Key,
      document_url: doc.pdfUrl,
      document_title: doc.title,
    });

    console.log(
      `Imported [${docType}] from ${doc.source}: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${doc.title} (confidence: ${classification.confidence.toFixed(2)})`
    );

    // LLM で分析
    const result = await analyzeEarningsDocument(
      env,
      earnings.id,
      storedPdf.buffer
    );
    if (result) {
      console.log(
        `Analyzed: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${result.customAnalysisCount} custom analyses`
      );
    }

    return { imported: true, hash: storedPdf.contentHash };
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

  // PARALLEL_LIMIT 件ずつ並列処理
  for (let i = 0; i < classifiedDocs.length; i += PARALLEL_LIMIT) {
    const batch = classifiedDocs.slice(i, i + PARALLEL_LIMIT);

    const results = await Promise.all(
      batch.map(doc => processDocument(env, stockCode, doc, existingHashes))
    );

    // 結果を集計し、新しいハッシュを追加
    for (const result of results) {
      if (result.imported && result.hash) {
        existingHashes.add(result.hash);
        imported++;
      } else {
        skipped++;
      }
    }
  }

  console.log(
    `Import complete for ${stockCode}: ${imported} imported, ${skipped} skipped`
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
