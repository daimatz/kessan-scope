import { Hono } from 'hono';
import type { Env, RegenerateQueueMessage } from '../types';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  updateWatchlistItem,
  getUserById,
  getWatchlistItemById,
} from '../db/queries';
import { enqueueHistoricalImport } from '../services/historicalImport';

const watchlist = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// ウォッチリスト取得
watchlist.get('/', async (c) => {
  const userId = c.get('userId');
  const items = await getWatchlist(c.env.DB, userId);
  return c.json({ items });
});

// 銘柄追加
watchlist.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    stock_code: string;
    stock_name?: string;
    custom_prompt?: string;
  }>();

  if (!body.stock_code || !/^\d{4,5}$/.test(body.stock_code)) {
    return c.json({ error: '証券コードは4〜5桁の数字です' }, 400);
  }

  // ユーザー情報を取得
  const user = await getUserById(c.env.DB, userId);
  if (!user) {
    return c.json({ error: 'ユーザーが見つかりません' }, 401);
  }

  try {
    const item = await addToWatchlist(c.env.DB, {
      user_id: userId,
      stock_code: body.stock_code,
      stock_name: body.stock_name || null,
      custom_prompt: body.custom_prompt || null,
    });

    // Queueに過去決算インポートジョブを追加
    c.executionCtx.waitUntil(
      enqueueHistoricalImport(
        c.env.IMPORT_QUEUE,
        body.stock_code,
        body.stock_name || null,
        userId,
        user.email
      ).catch((error) => {
        console.error(`Failed to enqueue historical import for ${body.stock_code}:`, error);
      })
    );

    return c.json({
      item,
      importStarted: true,
      message: '過去の決算資料をインポート中です。完了したらメールでお知らせします。',
    }, 201);
  } catch (error) {
    // UNIQUE constraint violation
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      return c.json({ error: 'この銘柄は既にウォッチリストにあります' }, 409);
    }
    throw error;
  }
});

// 銘柄削除
watchlist.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const deleted = await removeFromWatchlist(c.env.DB, id, userId);
  if (!deleted) {
    return c.json({ error: '銘柄が見つかりません' }, 404);
  }

  return c.json({ success: true });
});

// 銘柄設定更新
watchlist.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await c.req.json<{
    stock_name?: string;
    custom_prompt?: string;
  }>();

  const updated = await updateWatchlistItem(c.env.DB, id, userId, {
    stock_name: body.stock_name,
    custom_prompt: body.custom_prompt,
  });

  if (!updated) {
    return c.json({ error: '銘柄が見つかりません' }, 404);
  }

  return c.json({ success: true });
});

// カスタム分析を再生成
watchlist.post('/:id/regenerate', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  // ウォッチリストアイテムを取得
  const item = await getWatchlistItemById(c.env.DB, id, userId);
  if (!item) {
    return c.json({ error: '銘柄が見つかりません' }, 404);
  }

  if (!item.custom_prompt) {
    return c.json({ error: 'カスタムプロンプトが設定されていません' }, 400);
  }

  // ユーザー情報を取得
  const user = await getUserById(c.env.DB, userId);
  if (!user) {
    return c.json({ error: 'ユーザーが見つかりません' }, 401);
  }

  // Queueに再生成ジョブを追加
  const message: RegenerateQueueMessage = {
    type: 'regenerate_custom_analysis',
    watchlistItemId: id,
    userId,
    userEmail: user.email,
  };

  c.executionCtx.waitUntil(
    c.env.IMPORT_QUEUE.send(message).catch((error) => {
      console.error(`Failed to enqueue regeneration for ${item.stock_code}:`, error);
    })
  );

  return c.json({
    success: true,
    message: '再分析を開始しました。完了したらメールでお知らせします。',
  });
});

export default watchlist;
