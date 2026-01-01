import { Hono } from 'hono';
import type { Env } from '../types';

interface Stock {
  code: string;
  name: string;
  market: string | null;
  sector: string | null;
}

const stocks = new Hono<{ Bindings: Env }>();

// 銘柄検索
stocks.get('/search', async (c) => {
  const query = c.req.query('q')?.trim();

  if (!query || query.length < 1) {
    return c.json({ stocks: [] });
  }

  // 証券コードまたは銘柄名で検索
  const results = await c.env.DB.prepare(
    `SELECT code, name, market, sector FROM stocks
     WHERE code LIKE ? OR name LIKE ?
     ORDER BY
       CASE WHEN code = ? THEN 0
            WHEN code LIKE ? THEN 1
            WHEN name LIKE ? THEN 2
            ELSE 3
       END,
       code
     LIMIT 20`
  )
    .bind(
      `${query}%`,
      `%${query}%`,
      query,
      `${query}%`,
      `${query}%`
    )
    .all<Stock>();

  return c.json({ stocks: results.results });
});

export default stocks;
