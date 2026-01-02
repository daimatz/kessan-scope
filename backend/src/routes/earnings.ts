import { Hono } from 'hono';
import type { Env, EarningsSummary } from '../types';
import {
  getEarnings,
  getEarningsById,
  getUserEarningsAnalysis,
  getCustomAnalysisHistory,
  getWatchlist,
  getUniquePromptsForStock,
  getAllAnalysesForEarnings,
  getEarningsReleaseById,
  getEarningsReleasesByStockCode,
  getDocumentsForRelease,
  getUserAnalysisByRelease,
  getCustomAnalysisHistoryForRelease,
} from '../db/queries';

const earnings = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// ============================================
// 具体的なパスを先に定義（/:id より前に）
// ============================================

// 決算一覧（ウォッチリストの銘柄のみ）- 旧API
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

// ============================================
// EarningsRelease ルート（新規）
// 注意: /:id より前に定義する必要がある
// ============================================

// リリース一覧（ダッシュボード用）
earnings.get('/releases', async (c) => {
  const userId = c.get('userId');

  // ユーザーのウォッチリストにある銘柄のリリースを取得
  const result = await c.env.DB.prepare(`
    SELECT er.*, w.stock_name
    FROM earnings_release er
    INNER JOIN watchlist w ON er.stock_code = w.stock_code AND w.user_id = ?
    ORDER BY er.fiscal_year DESC, er.fiscal_quarter DESC NULLS LAST
    LIMIT 50
  `).bind(userId).all();

  // 各リリースのドキュメント数とユーザー分析を取得
  const releasesWithDocs = await Promise.all(
    (result.results as Array<{
      id: string;
      release_type: string;
      stock_code: string;
      stock_name: string | null;
      fiscal_year: string;
      fiscal_quarter: number | null;
      summary: string | null;
    }>).map(async (r) => {
      const documents = await getDocumentsForRelease(c.env.DB, r.id);

      // ユーザー分析を別クエリで取得（テーブルがない場合はnull）
      let userAnalysis: { custom_analysis: string | null; notified_at: string | null } | null = null;
      try {
        userAnalysis = await c.env.DB.prepare(
          'SELECT custom_analysis, notified_at FROM user_release_analysis WHERE user_id = ? AND release_id = ?'
        ).bind(userId, r.id).first();
      } catch {
        // テーブルがまだない場合は無視
      }

      return {
        id: r.id,
        release_type: r.release_type,
        stock_code: r.stock_code,
        stock_name: r.stock_name,
        fiscal_year: r.fiscal_year,
        fiscal_quarter: r.fiscal_quarter,
        has_summary: !!r.summary,
        has_custom_analysis: !!userAnalysis?.custom_analysis,
        notified_at: userAnalysis?.notified_at ?? null,
        document_count: documents.length,
        documents: documents.map(d => ({
          id: d.id,
          document_type: d.document_type,
        })),
      };
    })
  );

  return c.json({ releases: releasesWithDocs });
});

// 銘柄別リリース履歴
earnings.get('/releases/stock/:code', async (c) => {
  const userId = c.get('userId');
  const code = c.req.param('code');

  if (!/^\d{4,5}$/.test(code)) {
    return c.json({ error: '無効な証券コードです' }, 400);
  }

  // ウォッチリスト情報を取得
  const watchlist = await getWatchlist(c.env.DB, userId);
  const watchlistItem = watchlist.find(w => w.stock_code === code);

  // リリース一覧を取得
  const releasesList = await getEarningsReleasesByStockCode(c.env.DB, code);

  // 各リリースのユーザー分析情報とドキュメント数を取得
  const releasesWithInfo = await Promise.all(
    releasesList.map(async (r) => {
      const userAnalysis = await getUserAnalysisByRelease(c.env.DB, userId, r.id);
      const documents = await getDocumentsForRelease(c.env.DB, r.id);
      const historyCount = (await getCustomAnalysisHistoryForRelease(c.env.DB, userId, r.id)).length;

      return {
        id: r.id,
        release_type: r.release_type,
        fiscal_year: r.fiscal_year,
        fiscal_quarter: r.fiscal_quarter,
        has_summary: !!r.summary,
        has_custom_analysis: !!userAnalysis?.custom_analysis,
        analysis_history_count: historyCount,
        document_count: documents.length,
        documents: documents.map(d => ({
          id: d.id,
          document_type: d.document_type,
          document_title: d.document_title,
          has_pdf: !!d.r2_key,
        })),
      };
    })
  );

  return c.json({
    stock_code: code,
    stock_name: watchlistItem?.stock_name || null,
    custom_prompt: watchlistItem?.custom_prompt || null,
    watchlist_id: watchlistItem?.id || null,
    releases: releasesWithInfo,
  });
});

// リリース詳細（決算短信 + プレゼンのセット）
earnings.get('/release/:releaseId', async (c) => {
  const userId = c.get('userId');
  const releaseId = c.req.param('releaseId');

  const release = await getEarningsReleaseById(c.env.DB, releaseId);
  if (!release) {
    return c.json({ error: '決算発表が見つかりません' }, 404);
  }

  // ウォッチリストから銘柄名を取得
  const watchlist = await getWatchlist(c.env.DB, userId);
  const watchlistItem = watchlist.find(w => w.stock_code === release.stock_code);

  // リリースに紐づくドキュメント一覧を取得
  const documents = await getDocumentsForRelease(c.env.DB, releaseId);

  // ユーザー固有の分析を取得
  const userAnalysis = await getUserAnalysisByRelease(c.env.DB, userId, releaseId);

  // カスタム分析履歴を取得
  const analysisHistory = await getCustomAnalysisHistoryForRelease(c.env.DB, userId, releaseId);

  // サマリーをパース
  let summary: EarningsSummary | null = null;
  if (release.summary) {
    try {
      summary = JSON.parse(release.summary);
    } catch {
      // ignore parse error
    }
  }

  let highlights: string[] = [];
  if (release.highlights) {
    try {
      highlights = JSON.parse(release.highlights);
    } catch {
      // ignore
    }
  }

  let lowlights: string[] = [];
  if (release.lowlights) {
    try {
      lowlights = JSON.parse(release.lowlights);
    } catch {
      // ignore
    }
  }

  // カスタム分析をパース
  let customAnalysis = null;
  if (userAnalysis?.custom_analysis) {
    try {
      customAnalysis = JSON.parse(userAnalysis.custom_analysis);
    } catch {
      // ignore
    }
  }

  // 同じ銘柄の前後のリリースを取得（時系列ナビゲーション用）
  const allReleases = await getEarningsReleasesByStockCode(c.env.DB, release.stock_code);
  const currentIndex = allReleases.findIndex(r => r.id === releaseId);
  // allReleases は fiscal_year DESC, fiscal_quarter DESC でソートされている
  const nextRelease = currentIndex > 0 ? allReleases[currentIndex - 1] : null;
  const prevRelease = currentIndex < allReleases.length - 1 ? allReleases[currentIndex + 1] : null;

  return c.json({
    release: {
      id: release.id,
      release_type: release.release_type,
      stock_code: release.stock_code,
      stock_name: watchlistItem?.stock_name || null,
      fiscal_year: release.fiscal_year,
      fiscal_quarter: release.fiscal_quarter,
      summary,
      highlights,
      lowlights,
      documents: documents.map(doc => ({
        id: doc.id,
        document_type: doc.document_type,
        document_title: doc.document_title,
        r2_key: doc.r2_key,
        announcement_date: doc.announcement_date,
      })),
    },
    customAnalysis,
    customPromptUsed: userAnalysis?.custom_prompt_used || null,
    notifiedAt: userAnalysis?.notified_at || null,
    analysisHistory: analysisHistory.map(h => ({
      prompt: h.custom_prompt,
      analysis: h.analysis,
      created_at: h.created_at,
    })),
    prevRelease: prevRelease ? {
      id: prevRelease.id,
      fiscal_year: prevRelease.fiscal_year,
      fiscal_quarter: prevRelease.fiscal_quarter,
      release_type: prevRelease.release_type,
    } : null,
    nextRelease: nextRelease ? {
      id: nextRelease.id,
      fiscal_year: nextRelease.fiscal_year,
      fiscal_quarter: nextRelease.fiscal_quarter,
      release_type: nextRelease.release_type,
    } : null,
  });
});

// リリース内の個別PDF取得
earnings.get('/release/:releaseId/pdf/:documentType', async (c) => {
  const releaseId = c.req.param('releaseId');
  const documentType = c.req.param('documentType');

  const release = await getEarningsReleaseById(c.env.DB, releaseId);
  if (!release) {
    return c.json({ error: '決算発表が見つかりません' }, 404);
  }

  const documents = await getDocumentsForRelease(c.env.DB, releaseId);
  const targetDoc = documents.find(d => d.document_type === documentType);

  if (!targetDoc || !targetDoc.r2_key) {
    return c.json({ error: 'PDFが見つかりません' }, 404);
  }

  // R2からPDFを取得
  const object = await c.env.PDF_BUCKET.get(targetDoc.r2_key);
  if (!object) {
    return c.json({ error: 'PDFが見つかりません' }, 404);
  }

  const quarterStr = release.fiscal_quarter ? `Q${release.fiscal_quarter}` : '';
  const fileName = `${release.stock_code}_${release.fiscal_year}${quarterStr}_${documentType}.pdf`;

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
    },
  });
});

// ============================================
// 旧 Earnings ルート（後方互換用）
// 注意: パラメータ付きルートは最後に定義
// ============================================

// 銘柄別決算履歴（旧API）
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

// 決算詳細（旧API）
earnings.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const earningsData = await getEarningsById(c.env.DB, id);
  if (!earningsData) {
    return c.json({ error: '決算データが見つかりません' }, 404);
  }

  // ユーザー固有の分析を取得
  const userAnalysis = await getUserEarningsAnalysis(c.env.DB, userId, id);

  // この銘柄で使われたすべてのユニークなプロンプト
  const uniquePrompts = await getUniquePromptsForStock(c.env.DB, userId, earningsData.stock_code);

  // この決算資料に対するすべての分析（プロンプトごと）
  const allAnalyses = await getAllAnalysesForEarnings(c.env.DB, userId, id);

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
    notifiedAt: userAnalysis?.notified_at || null,
    // 銘柄で使用されたすべてのユニークなプロンプト（分析軸）
    availablePrompts: uniquePrompts,
    // この決算資料に対するすべての分析（プロンプトごと）
    analysesByPrompt: allAnalyses.map(a => ({
      prompt: a.prompt,
      analysis: a.analysis,
      created_at: a.created_at,
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

// PDF取得（旧API）
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

export default earnings;
