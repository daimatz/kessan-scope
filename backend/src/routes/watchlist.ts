import { Hono } from 'hono';
import type { Env } from '../types';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  updateWatchlistItem,
} from '../db/queries';

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

  try {
    const item = await addToWatchlist(c.env.DB, {
      user_id: userId,
      stock_code: body.stock_code,
      stock_name: body.stock_name || null,
      custom_prompt: body.custom_prompt || null,
    });
    return c.json({ item }, 201);
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

export default watchlist;
