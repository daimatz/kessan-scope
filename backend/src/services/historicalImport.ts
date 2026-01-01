import {
  TdnetClient,
  isEarningsSummary,
  determineFiscalYear,
  determineFiscalQuarter,
} from './tdnet';
import { createEarnings, getEarnings } from '../db/queries';
import type { Env, ImportQueueMessage } from '../types';

// ウォッチリスト追加時に呼び出す：Queueにメッセージを送信
export async function enqueueHistoricalImport(
  queue: Queue<ImportQueueMessage>,
  stockCode: string
): Promise<void> {
  const message: ImportQueueMessage = {
    type: 'import_historical_earnings',
    stockCode,
    startDate: '', // TDnetでは不要
    endDate: '',
  };

  await queue.send(message);
  console.log(`Enqueued historical import for ${stockCode}`);
}

// Queue Consumerで呼び出す：TDnetから決算データをインポート
export async function processImportBatch(
  env: Env,
  message: ImportQueueMessage
): Promise<void> {
  const { stockCode } = message;
  const client = new TdnetClient();

  console.log(`Importing earnings for ${stockCode} from TDnet...`);

  // 既存の決算データを取得（重複防止）
  const existingEarnings = await getEarnings(env.DB, stockCode);
  const existingKeys = new Set(
    existingEarnings.map((e) => `${e.fiscal_year}-${e.fiscal_quarter}`)
  );

  let imported = 0;
  let skipped = 0;

  try {
    // TDnetから銘柄の全開示情報を取得
    const documents = await client.getDocumentsByStock(stockCode);
    console.log(`Found ${documents.length} documents for ${stockCode}`);

    // 決算短信のみフィルタリング
    const earningsSummaries = client.filterEarningsSummaries(documents);
    console.log(`Found ${earningsSummaries.length} earnings summaries`);

    for (const doc of earningsSummaries) {
      const fiscalYear = determineFiscalYear(doc.title);
      const fiscalQuarter = determineFiscalQuarter(doc.title);

      if (!fiscalYear || fiscalQuarter === 0) {
        console.log(`Skipping (cannot parse): ${doc.title}`);
        skipped++;
        continue;
      }

      // 同じ年度・四半期のデータが既にあればスキップ
      const key = `${fiscalYear}-${fiscalQuarter}`;
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      try {
        // 日付を抽出 (pubdate: "2025-11-05 14:25:00" → "2025-11-05")
        const announcementDate = doc.pubdate.split(' ')[0];

        await createEarnings(env.DB, {
          stock_code: stockCode,
          fiscal_year: fiscalYear,
          fiscal_quarter: fiscalQuarter,
          announcement_date: announcementDate,
          edinet_doc_id: doc.id, // TDnetのIDを保存
        });

        existingKeys.add(key);
        imported++;

        console.log(
          `Imported: ${stockCode} ${fiscalYear}Q${fiscalQuarter} - ${doc.title}`
        );
      } catch (error) {
        console.error(`Failed to create earnings for ${doc.id}:`, error);
      }
    }
  } catch (error) {
    console.error(`Failed to fetch TDnet data for ${stockCode}:`, error);
  }

  console.log(
    `Import complete for ${stockCode}: ${imported} imported, ${skipped} skipped`
  );
}
