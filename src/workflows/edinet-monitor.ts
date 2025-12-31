// EDINET監視ワークフロー
// Cloudflare Cron Triggerで定期実行

import type { Env } from '../types';
import { EdinetClient } from '../services/edinet';

export interface EdinetMonitorResult {
  date: string;
  totalDocuments: number;
  matchedDocuments: number;
  triggeredWorkflows: string[];
}

export async function monitorEdinet(env: Env): Promise<EdinetMonitorResult> {
  const client = new EdinetClient(env.EDINET_API_KEY);
  
  // 今日の日付
  const today = new Date().toISOString().split('T')[0];
  
  // ウォッチリストの全銘柄を取得
  const watchlistResult = await env.DB.prepare(
    'SELECT DISTINCT stock_code FROM watchlist'
  ).all<{ stock_code: string }>();
  
  const stockCodes = watchlistResult.results.map(r => r.stock_code);
  
  if (stockCodes.length === 0) {
    return {
      date: today,
      totalDocuments: 0,
      matchedDocuments: 0,
      triggeredWorkflows: [],
    };
  }
  
  // EDINETから今日の書類を取得
  const documents = await client.getDocumentList(today);
  
  // 決算短信をフィルタリング
  const earningsReports = client.filterEarningsReports(documents, stockCodes);
  
  const triggeredWorkflows: string[] = [];
  
  for (const report of earningsReports) {
    const stockCode = report.secCode?.slice(0, 4);
    if (!stockCode) continue;
    
    // 既に処理済みかチェック
    const existing = await env.DB.prepare(
      'SELECT id FROM earnings WHERE edinet_doc_id = ?'
    ).bind(report.docID).first();
    
    if (existing) continue;
    
    // 決算分析ワークフローをトリガー
    // 実際のWorkflows実装では、ここでWorkflowを起動
    // 以下はプレースホルダー
    console.log(`Triggering earnings analysis for ${stockCode}: ${report.docID}`);
    triggeredWorkflows.push(`${stockCode}:${report.docID}`);
    
    // TODO: Cloudflare Workflowsの実際の呼び出し
    // await env.EARNINGS_WORKFLOW.create({
    //   params: {
    //     docId: report.docID,
    //     stockCode,
    //     periodEnd: report.periodEnd,
    //   },
    // });
  }
  
  return {
    date: today,
    totalDocuments: documents.length,
    matchedDocuments: earningsReports.length,
    triggeredWorkflows,
  };
}

// Cron Triggerハンドラ
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      monitorEdinet(env)
        .then(result => {
          console.log('EDINET monitor completed:', result);
        })
        .catch(error => {
          console.error('EDINET monitor failed:', error);
        })
    );
  },
};
