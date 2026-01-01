// 決算分析ワークフロー
// EDINETから決算短信を取得し、OpenAIで分析、通知送信

import type { Env, EarningsSummary } from '../types';
import { EdinetClient } from '../services/edinet';
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
  docId: string;
  stockCode: string;
  periodEnd: string | null;
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
  const { docId, stockCode, periodEnd } = params;
  
  const edinetClient = new EdinetClient(env.EDINET_API_KEY);
  
  // 1. EDINETからPDFを取得
  console.log(`Fetching PDF for ${docId}...`);
  const pdfBuffer = await edinetClient.getDocumentPdf(docId);
  
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
  const fiscalQuarter = EdinetClient.determineFiscalQuarter(periodEnd);
  const fiscalYear = EdinetClient.determineFiscalYear(periodEnd);
  
  const earnings = await createEarnings(env.DB, {
    stock_code: stockCode,
    fiscal_year: fiscalYear || new Date().getFullYear().toString(),
    fiscal_quarter: fiscalQuarter || 1,
    announcement_date: new Date().toISOString().split('T')[0],
    edinet_doc_id: docId,
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
