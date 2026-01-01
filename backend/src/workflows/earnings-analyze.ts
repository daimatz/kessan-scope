// 決算分析ワークフロー
// TDnetから決算短信を取得し、OpenAIで分析、通知送信

import type { Env, EarningsSummary } from '../types';
import { OpenAIService } from '../services/openai';
import { MailerSendClient } from '../services/mailersend';
import {
  createEarnings,
  updateEarningsAnalysis,
  getWatchlistByStockCode,
  createUserEarningsAnalysis,
  markAsNotified,
  getUserById,
} from '../db/queries';

export interface EarningsAnalyzeParams {
  tdnetDocId: string;
  stockCode: string;
  documentUrl: string;
  fiscalYear: string;
  fiscalQuarter: number;
  announcementDate: string;
}

export interface EarningsAnalyzeResult {
  earningsId: string;
  stockCode: string;
  notifiedUsers: number;
}

export async function analyzeEarnings(
  env: Env,
  params: EarningsAnalyzeParams
): Promise<EarningsAnalyzeResult> {
  const { tdnetDocId, stockCode, documentUrl, fiscalYear, fiscalQuarter, announcementDate } = params;

  // 1. TDnetから直接PDFを取得
  console.log(`Fetching PDF from ${documentUrl}...`);
  const pdfResponse = await fetch(documentUrl);
  if (!pdfResponse.ok) {
    throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
  }
  const pdfBuffer = await pdfResponse.arrayBuffer();

  // 2. PDFを画像に変換（実際の実装では外部サービスが必要）
  // Workers環境ではPDF.jsなどが使えないため、
  // 実際には以下のいずれかのアプローチが必要:
  // - Cloudflare R2にPDFを保存し、別のWorkerで変換
  // - 外部API（pdf2imageサービス等）を使用
  // - Cloudflare Browser Rendering APIを使用
  console.log(`Converting PDF to images... (${pdfBuffer.byteLength} bytes)`);

  // 今はプレースホルダーとして空配列
  const pdfImages: string[] = [];

  // 3. 決算レコードを作成
  const earnings = await createEarnings(env.DB, {
    stock_code: stockCode,
    fiscal_year: fiscalYear,
    fiscal_quarter: fiscalQuarter,
    announcement_date: announcementDate,
    edinet_doc_id: tdnetDocId, // TDnetのIDを保存（カラム名は歴史的理由でedinet_doc_id）
  });

  // 4. OpenAIで分析
  let summary: EarningsSummary | null = null;

  if (pdfImages.length > 0) {
    const openai = new OpenAIService(env.OPENAI_API_KEY, 'gpt-4o');
    summary = await openai.analyzeEarningsPdf(pdfImages);

    await updateEarningsAnalysis(env.DB, earnings.id, {
      summary: JSON.stringify(summary),
      highlights: JSON.stringify(summary.highlights),
      lowlights: JSON.stringify(summary.lowlights),
    });
  }

  // 5. ウォッチリストのユーザーに通知
  const watchlistItems = await getWatchlistByStockCode(env.DB, stockCode);

  // MailerSendクライアントの初期化（送信元ドメインは環境変数で設定必要）
  const mailer = new MailerSendClient(
    env.MAILERSEND_API_KEY,
    'noreply@stock-watcher.example.com', // 実際のドメインに変更
    'Stock Watcher'
  );

  let notifiedUsers = 0;

  for (const item of watchlistItems) {
    const user = await getUserById(env.DB, item.user_id);
    if (!user) continue;

    // カスタム分析を実行（プロンプトがある場合）
    let customAnalysis: string | null = null;
    if (item.custom_prompt && summary) {
      const openai = new OpenAIService(env.OPENAI_API_KEY, user.openai_model);
      customAnalysis = await openai.analyzeWithCustomPrompt(summary, item.custom_prompt);
    }

    // ユーザー分析レコードを作成
    const analysis = await createUserEarningsAnalysis(env.DB, {
      user_id: item.user_id,
      earnings_id: earnings.id,
      custom_analysis: customAnalysis,
    });

    // メール送信
    try {
      const detailUrl = `${env.FRONTEND_URL}/earnings/${earnings.id}`;

      await mailer.sendEarningsNotification({
        to: { email: user.email, name: user.name || undefined },
        stockCode,
        stockName: item.stock_name || stockCode,
        fiscalYear: earnings.fiscal_year,
        fiscalQuarter: earnings.fiscal_quarter,
        highlights: summary?.highlights || [],
        lowlights: summary?.lowlights || [],
        detailUrl,
      });

      await markAsNotified(env.DB, analysis.id);
      notifiedUsers++;
    } catch (error) {
      console.error(`Failed to notify user ${user.id}:`, error);
    }
  }

  return {
    earningsId: earnings.id,
    stockCode,
    notifiedUsers,
  };
}
