import { Hono } from 'hono';
import type { Env, EarningsSummary } from '../types';
import {
  getEarnings,
  getEarningsById,
  getUserEarningsAnalysis,
} from '../db/queries';

const earnings = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// 決算一覧（ウォッチリストの銘柄のみ）
earnings.get('/', async (c) => {
  const userId = c.get('userId');
  
  // ユーザーのウォッチリストにある銘柄の決算を取得
  const result = await c.env.DB.prepare(`
    SELECT e.*, w.stock_name, uea.custom_analysis, uea.notified_at
    FROM earnings e
    INNER JOIN watchlist w ON e.stock_code = w.stock_code AND w.user_id = ?
    LEFT JOIN user_earnings_analysis uea ON e.id = uea.earnings_id AND uea.user_id = ?
    ORDER BY e.announcement_date DESC
    LIMIT 50
  `).bind(userId, userId).all();

  return c.json({ earnings: result.results });
});

// 決算詳細
earnings.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const earningsData = await getEarningsById(c.env.DB, id);
  if (!earningsData) {
    return c.json({ error: '決算データが見つかりません' }, 404);
  }

  // ユーザー固有の分析を取得
  const userAnalysis = await getUserEarningsAnalysis(c.env.DB, userId, id);

  // サマリーをパース
  let summary: EarningsSummary | null = null;
  if (earningsData.summary) {
    try {
      summary = JSON.parse(earningsData.summary);
    } catch {
      // ignore parse error
    }
  }

  let highlights: string[] = [];
  if (earningsData.highlights) {
    try {
      highlights = JSON.parse(earningsData.highlights);
    } catch {
      // ignore
    }
  }

  let lowlights: string[] = [];
  if (earningsData.lowlights) {
    try {
      lowlights = JSON.parse(earningsData.lowlights);
    } catch {
      // ignore
    }
  }

  return c.json({
    earnings: {
      id: earningsData.id,
      stock_code: earningsData.stock_code,
      fiscal_year: earningsData.fiscal_year,
      fiscal_quarter: earningsData.fiscal_quarter,
      announcement_date: earningsData.announcement_date,
      summary,
      highlights,
      lowlights,
    },
    userAnalysis: userAnalysis?.custom_analysis || null,
    notifiedAt: userAnalysis?.notified_at || null,
  });
});

// 銘柄別決算履歴
earnings.get('/stock/:code', async (c) => {
  const code = c.req.param('code');

  if (!/^\d{4}$/.test(code)) {
    return c.json({ error: '無効な証券コードです' }, 400);
  }

  const earningsList = await getEarnings(c.env.DB, code);

  return c.json({
    stock_code: code,
    earnings: earningsList.map(e => ({
      id: e.id,
      fiscal_year: e.fiscal_year,
      fiscal_quarter: e.fiscal_quarter,
      announcement_date: e.announcement_date,
      has_summary: !!e.summary,
    })),
  });
});

export default earnings;
