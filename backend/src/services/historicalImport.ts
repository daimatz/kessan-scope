import { getDocumentCandidates, determineFiscalYear, determineFiscalQuarter, getDocumentType } from './documentSources';
import { createEarnings, getExistingContentHashes, checkUrlExists } from '../db/queries';
import { analyzeEarningsDocument } from './earningsAnalyzer';
import { fetchAndStorePdf } from './pdfStorage';
import type { Env, ImportQueueMessage } from '../types';

// ウォッチリスト追加時に呼び出す：Queueにメッセージを送信
export async function enqueueHistoricalImport(
  queue: Queue<ImportQueueMessage>,
  stockCode: string
): Promise<void> {
  const message: ImportQueueMessage = {
    type: 'import_historical_earnings',
    stockCode,
  };

  await queue.send(message);
  console.log(`Enqueued historical import for ${stockCode}`);
}

// Queue Consumerで呼び出す：TDnet + IRBANK から決算データをインポート
export async function processImportBatch(
  env: Env,
  message: ImportQueueMessage
): Promise<void> {
  const { stockCode } = message;

  console.log(`Importing earnings for ${stockCode}...`);

  // 既存の content_hash を取得（重複防止）
  const existingHashes = await getExistingContentHashes(env.DB, stockCode);
  console.log(`Found ${existingHashes.size} existing documents`);

  // TDnet + IRBANK からドキュメント候補を取得
  const candidates = await getDocumentCandidates(stockCode);

  let imported = 0;
  let skipped = 0;

  for (const doc of candidates) {
    const fiscalYear = determineFiscalYear(doc.title, doc.pubdate);
    const fiscalQuarter = determineFiscalQuarter(doc.title);
    const docType = getDocumentType(doc.title);

    if (!fiscalYear) {
      console.log(`Skipping (cannot parse year): ${doc.title}`);
      skipped++;
      continue;
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
        skipped++;
        continue;
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

      existingHashes.add(storedPdf.contentHash);
      imported++;

      console.log(
        `Imported [${docType}] from ${doc.source}: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${doc.title}`
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
    } catch (error) {
      console.error(`Failed to import from ${doc.source}:`, error);
    }
  }

  console.log(
    `Import complete for ${stockCode}: ${imported} imported, ${skipped} skipped`
  );
}
