import { EdinetClient } from './edinet';
import { createEarnings, getEarnings } from '../db/queries';
import type { Env, ImportQueueMessage } from '../types';

// 1回のバッチで処理する日数（Workersタイムアウト対策）
const BATCH_DAYS = 7;

// 過去何日分を取得するか（約1年分）
const DEFAULT_LOOKBACK_DAYS = 365;

// 日付をYYYY-MM-DD形式で返す
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// 文字列からDateオブジェクトを作成
function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z');
}

// 週末かどうか判定
function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

// 指定期間の平日リストを生成
function generateBusinessDays(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const current = new Date(start);
  while (current <= end) {
    if (!isWeekend(current)) {
      dates.push(formatDate(current));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

// ウォッチリスト追加時に呼び出す：Queueに初期メッセージを送信
export async function enqueueHistoricalImport(
  queue: Queue<ImportQueueMessage>,
  stockCode: string,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS
): Promise<void> {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setUTCDate(today.getUTCDate() - lookbackDays);

  const message: ImportQueueMessage = {
    type: 'import_historical_earnings',
    stockCode,
    startDate: formatDate(startDate),
    endDate: formatDate(today),
  };

  await queue.send(message);
  console.log(`Enqueued historical import for ${stockCode}: ${message.startDate} to ${message.endDate}`);
}

// Queue Consumerで呼び出す：バッチ処理
export async function processImportBatch(
  env: Env,
  message: ImportQueueMessage
): Promise<void> {
  const { stockCode, startDate, endDate } = message;
  const client = new EdinetClient(env.EDINET_API_KEY);

  console.log(`Processing import batch for ${stockCode}: ${startDate} to ${endDate}`);

  // 既存の決算データを取得（重複防止）
  const existingEarnings = await getEarnings(env.DB, stockCode);
  const existingDocIds = new Set(
    existingEarnings.map((e) => e.edinet_doc_id).filter(Boolean)
  );
  const existingKeys = new Set(
    existingEarnings.map((e) => `${e.fiscal_year}-${e.fiscal_quarter}`)
  );

  // 処理する日付リストを生成
  const allDates = generateBusinessDays(startDate, endDate);

  // バッチサイズ分だけ処理
  const batchDates = allDates.slice(0, BATCH_DAYS);
  const remainingDates = allDates.slice(BATCH_DAYS);

  let imported = 0;
  let skipped = 0;

  for (const date of batchDates) {
    try {
      const documents = await client.getDocumentList(date);

      // 対象銘柄の四半期報告書・有価証券報告書をフィルタリング
      const earningsReports = documents.filter((doc) => {
        // 証券コードが一致するか（4桁で比較）
        const docSecCode4 = doc.secCode?.slice(0, 4);
        const stockCode4 = stockCode.slice(0, 4);
        if (docSecCode4 !== stockCode4) {
          return false;
        }

        // 四半期報告書 or 有価証券報告書（投資信託を除く）
        const desc = doc.docDescription || '';
        if (desc.includes('四半期報告書') && !desc.includes('内国投資信託')) {
          return true;
        }
        if (desc.startsWith('有価証券報告書－') && !desc.includes('内国投資信託')) {
          return true;
        }

        return false;
      });

      if (earningsReports.length > 0) {
        for (const doc of earningsReports) {
          console.log(`[${date}] Found: ${doc.secCode} - ${doc.docDescription}`);
        }
      }

      for (const doc of earningsReports) {
        // 既に取り込み済みならスキップ
        if (existingDocIds.has(doc.docID)) {
          skipped++;
          continue;
        }

        const fiscalYear = EdinetClient.determineFiscalYear(doc.periodEnd);
        const fiscalQuarter = EdinetClient.determineFiscalQuarter(doc.periodEnd);

        // 同じ年度・四半期のデータが既にあればスキップ
        const key = `${fiscalYear}-${fiscalQuarter}`;
        if (existingKeys.has(key)) {
          skipped++;
          continue;
        }

        try {
          await createEarnings(env.DB, {
            stock_code: stockCode,
            fiscal_year: fiscalYear,
            fiscal_quarter: fiscalQuarter,
            announcement_date: doc.submitDateTime.split(' ')[0],
            edinet_doc_id: doc.docID,
          });

          existingDocIds.add(doc.docID);
          existingKeys.add(key);
          imported++;

          console.log(`Imported: ${stockCode} ${fiscalYear}Q${fiscalQuarter} (${doc.docID})`);
        } catch (error) {
          console.error(`Failed to create earnings for ${doc.docID}:`, error);
        }
      }
    } catch (error) {
      console.error(`Failed to fetch documents for ${date}:`, error);
    }
  }

  console.log(`Batch complete for ${stockCode}: ${imported} imported, ${skipped} skipped`);

  // まだ処理する日付が残っていれば、次のバッチをキューに追加
  if (remainingDates.length > 0) {
    const nextMessage: ImportQueueMessage = {
      type: 'import_historical_earnings',
      stockCode,
      startDate: remainingDates[0],
      endDate,
    };

    await env.IMPORT_QUEUE.send(nextMessage);
    console.log(`Enqueued next batch for ${stockCode}: ${remainingDates.length} days remaining`);
  } else {
    console.log(`Import complete for ${stockCode}`);
  }
}
