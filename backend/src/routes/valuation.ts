import { Hono } from 'hono';
import type { Env } from '../types';
import { ValuationHistoryResponseSchema } from '@kessan-scope/shared';
import { getWatchlistItemByUserAndStock } from '../db/queries';
import {
  getValuationsByStockCode,
  syncValuationsFromReleases,
} from '../db/valuationQueries';

const valuation = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// 銘柄のバリュエーション履歴を取得
valuation.get('/:code', async (c) => {
  const userId = c.get('userId');
  const code = c.req.param('code');

  if (!/^[\dA-Z]{4}$/.test(code)) {
    return c.json({ error: '無効な証券コードです' }, 400);
  }

  // 認可チェック: ユーザーのウォッチリストに含まれているか確認
  const watchlistItem = await getWatchlistItemByUserAndStock(c.env.DB, userId, code);
  if (!watchlistItem) {
    return c.json({ error: 'この企業へのアクセス権がありません' }, 403);
  }

  // バリュエーションデータを取得
  const valuations = await getValuationsByStockCode(c.env.DB, code);

  return c.json(ValuationHistoryResponseSchema.parse({
    stock_code: code,
    stock_name: watchlistItem.stock_name,
    valuations: valuations.map(v => ({
      id: v.id,
      stock_code: v.stock_code,
      record_date: v.record_date,
      fiscal_year: v.fiscal_year,
      fiscal_quarter: v.fiscal_quarter,
      market_cap: v.market_cap,
      revenue: v.revenue,
      operating_income: v.operating_income,
      net_income: v.net_income,
      source: v.source,
    })),
  }));
});

// 決算データからバリュエーションを同期
valuation.post('/:code/sync', async (c) => {
  const userId = c.get('userId');
  const code = c.req.param('code');

  if (!/^[\dA-Z]{4}$/.test(code)) {
    return c.json({ error: '無効な証券コードです' }, 400);
  }

  // 認可チェック
  const watchlistItem = await getWatchlistItemByUserAndStock(c.env.DB, userId, code);
  if (!watchlistItem) {
    return c.json({ error: 'この企業へのアクセス権がありません' }, 403);
  }

  // 決算データからバリュエーションを同期
  const count = await syncValuationsFromReleases(c.env.DB, code);

  return c.json({ success: true, synced: count });
});

export default valuation;
