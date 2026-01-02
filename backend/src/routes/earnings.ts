import { Hono } from 'hono';
import type { Env, EarningsSummary } from '../types';
import {
  getEarnings,
  getEarningsById,
  getUserEarningsAnalysis,
  getCustomAnalysisHistory,
  getWatchlist,
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

  // カスタム分析履歴を取得
  const analysisHistory = await getCustomAnalysisHistory(c.env.DB, userId, id);

  // 同じ銘柄の前後の決算を取得（時系列ナビゲーション用）
  const allEarnings = await getEarnings(c.env.DB, earningsData.stock_code);
  const currentIndex = allEarnings.findIndex(e => e.id === id);
  // allEarnings は announcement_date DESC でソートされている
  // 次（新しい）= currentIndex - 1, 前（古い）= currentIndex + 1
  const nextEarnings = currentIndex > 0 ? allEarnings[currentIndex - 1] : null;
  const prevEarnings = currentIndex < allEarnings.length - 1 ? allEarnings[currentIndex + 1] : null;

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
      document_title: earningsData.document_title,
      r2_key: earningsData.r2_key,
      summary,
      highlights,
      lowlights,
    },
    userAnalysis: userAnalysis?.custom_analysis || null,
    userPromptUsed: userAnalysis?.custom_prompt_used || null,
    notifiedAt: userAnalysis?.notified_at || null,
    analysisHistory: analysisHistory.map(h => ({
      id: h.id,
      custom_prompt: h.custom_prompt,
      analysis: h.analysis,
      created_at: h.created_at,
    })),
    // 前後の決算（時系列ナビゲーション用）
    prevEarnings: prevEarnings ? {
      id: prevEarnings.id,
      fiscal_year: prevEarnings.fiscal_year,
      fiscal_quarter: prevEarnings.fiscal_quarter,
    } : null,
    nextEarnings: nextEarnings ? {
      id: nextEarnings.id,
      fiscal_year: nextEarnings.fiscal_year,
      fiscal_quarter: nextEarnings.fiscal_quarter,
    } : null,
  });
});

// PDF取得（署名付きURL or 直接返す）
earnings.get('/:id/pdf', async (c) => {
  const id = c.req.param('id');

  const earningsData = await getEarningsById(c.env.DB, id);
  if (!earningsData || !earningsData.r2_key) {
    return c.json({ error: 'PDFが見つかりません' }, 404);
  }

  // R2からPDFを取得
  const object = await c.env.PDF_BUCKET.get(earningsData.r2_key);
  if (!object) {
    return c.json({ error: 'PDFが見つかりません' }, 404);
  }

  // PDFを直接返す
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${earningsData.stock_code}_${earningsData.fiscal_year}Q${earningsData.fiscal_quarter}.pdf"`,
    },
  });
});

// 銘柄別決算履歴
earnings.get('/stock/:code', async (c) => {
  const userId = c.get('userId');
  const code = c.req.param('code');

  if (!/^\d{4,5}$/.test(code)) {
    return c.json({ error: '無効な証券コードです' }, 400);
  }

  // ウォッチリスト情報を取得
  const watchlist = await getWatchlist(c.env.DB, userId);
  const watchlistItem = watchlist.find(w => w.stock_code === code);

  // 決算一覧を取得（ユーザーの分析情報含む）
  const earningsList = await getEarnings(c.env.DB, code);

  // 各決算のユーザー分析情報を取得
  const earningsWithAnalysis = await Promise.all(
    earningsList.map(async (e) => {
      const userAnalysis = await getUserEarningsAnalysis(c.env.DB, userId, e.id);
      const historyCount = (await getCustomAnalysisHistory(c.env.DB, userId, e.id)).length;
      return {
        id: e.id,
        fiscal_year: e.fiscal_year,
        fiscal_quarter: e.fiscal_quarter,
        announcement_date: e.announcement_date,
        document_title: e.document_title,
        has_summary: !!e.summary,
        has_pdf: !!e.r2_key,
        has_custom_analysis: !!userAnalysis?.custom_analysis,
        analysis_history_count: historyCount,
      };
    })
  );

  return c.json({
    stock_code: code,
    stock_name: watchlistItem?.stock_name || null,
    custom_prompt: watchlistItem?.custom_prompt || null,
    watchlist_id: watchlistItem?.id || null,
    earnings: earningsWithAnalysis,
  });
});

export default earnings;
