// 再生成処理のQueueハンドラ

import { getWatchlistItemById, getUserById } from '../db/queries';
import { regenerateCustomAnalysis } from './earningsAnalyzer';
import { MailerSendClient } from './mailersend';
import type { Env, RegenerateQueueMessage } from '../types';

export async function processRegenerateBatch(
  env: Env,
  message: RegenerateQueueMessage
): Promise<void> {
  const { watchlistItemId, userId, userEmail } = message;

  console.log(`Processing regeneration for watchlist item ${watchlistItemId}...`);

  // ウォッチリストアイテムを取得
  const watchlistItem = await getWatchlistItemById(env.DB, watchlistItemId, userId);
  if (!watchlistItem) {
    console.error(`Watchlist item not found: ${watchlistItemId}`);
    return;
  }

  if (!watchlistItem.custom_prompt) {
    console.log('No custom prompt set, skipping regeneration');
    return;
  }

  // カスタム分析を再生成
  const result = await regenerateCustomAnalysis(env, watchlistItem);

  console.log(
    `Regeneration complete for ${watchlistItem.stock_code}: ${result.regenerated}/${result.total}`
  );

  // 完了通知メールを送信
  try {
    const mailer = new MailerSendClient(
      env.MAILERSEND_API_KEY,
      env.MAILERSEND_FROM_EMAIL
    );
    await mailer.sendRegenerateCompleteEmail({
      to: { email: userEmail },
      stockCode: watchlistItem.stock_code,
      stockName: watchlistItem.stock_name,
      regenerated: result.regenerated,
      cached: result.cached,
      total: result.total,
      skipped: result.skipped,
      dashboardUrl: `${env.FRONTEND_URL}/stocks/${watchlistItem.stock_code}`,
    });
    console.log(`Regeneration completion email sent to ${userEmail}`);
  } catch (error) {
    console.error('Failed to send regeneration completion email:', error);
  }
}
