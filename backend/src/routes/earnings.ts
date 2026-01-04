import { Hono } from 'hono';
import type { Env, EarningsSummary } from '../types';
import {
  DashboardReleaseSchema,
  StockReleasesResponseSchema,
  ReleaseDetailResponseSchema,
} from '@kessan-scope/shared';
import {
  getWatchlistItemByUserAndStock,
  getEarningsReleaseById,
  getEarningsReleasesByStockCode,
  getAdjacentReleases,
  getDocumentsForRelease,
  getUserAnalysisByRelease,
  getCustomAnalysisHistoryForRelease,
  getReleasesForDashboard,
  // バッチクエリ
  getDocumentsForReleases,
  getUserAnalysesForReleases,
  getAnalysisHistoryCountsForReleases,
} from '../db/queries';

const earnings = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// リリース一覧（ダッシュボード用）
earnings.get('/releases', async (c) => {
  const userId = c.get('userId');

  // ユーザーのウォッチリストにある銘柄のリリースを取得
  const releases = await getReleasesForDashboard(c.env.DB, userId);

  // バッチクエリでドキュメントとユーザー分析を一括取得
  const releaseIds = releases.map(r => r.id);
  const [documentsMap, analysesMap] = await Promise.all([
    getDocumentsForReleases(c.env.DB, releaseIds),
    getUserAnalysesForReleases(c.env.DB, userId, releaseIds),
  ]);

  // レスポンスを構築
  const releasesWithDocs = releases.map((r) => {
    const documents = documentsMap.get(r.id) || [];
    const userAnalysis = analysesMap.get(r.id);

    return {
      id: r.id,
      release_type: r.release_type,
      stock_code: r.stock_code,
      stock_name: r.stock_name,
      fiscal_year: r.fiscal_year,
      fiscal_quarter: r.fiscal_quarter,
      announcement_date: r.announcement_date ?? null,
      has_summary: !!r.summary,
      has_custom_analysis: !!userAnalysis?.custom_analysis,
      notified_at: userAnalysis?.notified_at ?? null,
      document_count: documents.length,
      documents: documents.map(d => ({
        id: d.id,
        document_type: d.document_type,
      })),
    };
  });

  // zod で API レスポンス用にフィルタリング
  return c.json({ releases: releasesWithDocs.map(r => DashboardReleaseSchema.parse(r)) });
});

// 銘柄別リリース履歴
earnings.get('/releases/stock/:code', async (c) => {
  const userId = c.get('userId');
  const code = c.req.param('code');

  if (!/^[\dA-Z]{4}$/.test(code)) {
    return c.json({ error: '無効な証券コードです' }, 400);
  }

  // ウォッチリスト情報を取得（直接SQLで特定銘柄を取得）
  const watchlistItem = await getWatchlistItemByUserAndStock(c.env.DB, userId, code);

  // 認可チェック: ユーザーのウォッチリストに含まれているか確認
  if (!watchlistItem) {
    return c.json({ error: 'この銘柄へのアクセス権がありません' }, 403);
  }

  // リリース一覧を取得
  const releasesList = await getEarningsReleasesByStockCode(c.env.DB, code);

  // バッチクエリでドキュメント、ユーザー分析、履歴件数を一括取得
  const releaseIds = releasesList.map(r => r.id);
  const [documentsMap, analysesMap, historyCountsMap] = await Promise.all([
    getDocumentsForReleases(c.env.DB, releaseIds),
    getUserAnalysesForReleases(c.env.DB, userId, releaseIds),
    getAnalysisHistoryCountsForReleases(c.env.DB, userId, releaseIds),
  ]);

  // レスポンスを構築
  const releasesWithInfo = releasesList.map((r) => {
    const documents = documentsMap.get(r.id) || [];
    const userAnalysis = analysesMap.get(r.id);
    const historyCount = historyCountsMap.get(r.id) || 0;

    return {
      id: r.id,
      release_type: r.release_type,
      fiscal_year: r.fiscal_year,
      fiscal_quarter: r.fiscal_quarter,
      announcement_date: r.announcement_date ?? null,
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
  });

  // zod で API レスポンス用にフィルタリング
  return c.json(StockReleasesResponseSchema.parse({
    stock_code: code,
    stock_name: watchlistItem?.stock_name || null,
    custom_prompt: watchlistItem?.custom_prompt || null,
    watchlist_id: watchlistItem?.id || null,
    releases: releasesWithInfo,
  }));
});

// リリース詳細（決算短信 + プレゼンのセット）
earnings.get('/release/:releaseId', async (c) => {
  const userId = c.get('userId');
  const releaseId = c.req.param('releaseId');

  const release = await getEarningsReleaseById(c.env.DB, releaseId);
  if (!release) {
    return c.json({ error: '決算発表が見つかりません' }, 404);
  }

  // ウォッチリストから銘柄名を取得（直接SQLで特定銘柄を取得）
  const watchlistItem = await getWatchlistItemByUserAndStock(c.env.DB, userId, release.stock_code);

  // 認可チェック: ユーザーのウォッチリストに含まれているか確認
  if (!watchlistItem) {
    return c.json({ error: 'この銘柄へのアクセス権がありません' }, 403);
  }

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

  // 同じ銘柄の前後のリリースを取得（時系列ナビゲーション用・SQLで直接取得）
  const { prev: prevRelease, next: nextRelease } = await getAdjacentReleases(
    c.env.DB,
    release.stock_code,
    releaseId
  );

  // zod で API レスポンス用にフィルタリング
  return c.json(ReleaseDetailResponseSchema.parse({
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
        file_size: doc.file_size,
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
  }));
});

// リリース内の個別PDF取得
earnings.get('/release/:releaseId/pdf/:documentType', async (c) => {
  const userId = c.get('userId');
  const releaseId = c.req.param('releaseId');
  const documentType = c.req.param('documentType');

  const release = await getEarningsReleaseById(c.env.DB, releaseId);
  if (!release) {
    return c.json({ error: '決算発表が見つかりません' }, 404);
  }

  // 認可チェック: ユーザーのウォッチリストに含まれているか確認（直接SQLで確認）
  const watchlistItem = await getWatchlistItemByUserAndStock(c.env.DB, userId, release.stock_code);
  if (!watchlistItem) {
    return c.json({ error: 'この銘柄へのアクセス権がありません' }, 403);
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

// ドキュメントIDで個別PDF取得（同じdocument_typeの複数ドキュメント対応）
earnings.get('/release/:releaseId/pdf/doc/:documentId', async (c) => {
  const userId = c.get('userId');
  const releaseId = c.req.param('releaseId');
  const documentId = c.req.param('documentId');

  const release = await getEarningsReleaseById(c.env.DB, releaseId);
  if (!release) {
    return c.json({ error: '決算発表が見つかりません' }, 404);
  }

  // 認可チェック: ユーザーのウォッチリストに含まれているか確認
  const watchlistItem = await getWatchlistItemByUserAndStock(c.env.DB, userId, release.stock_code);
  if (!watchlistItem) {
    return c.json({ error: 'この銘柄へのアクセス権がありません' }, 403);
  }

  const documents = await getDocumentsForRelease(c.env.DB, releaseId);
  const targetDoc = documents.find(d => d.id === documentId);

  if (!targetDoc || !targetDoc.r2_key) {
    return c.json({ error: 'PDFが見つかりません' }, 404);
  }

  // R2からPDFを取得
  const object = await c.env.PDF_BUCKET.get(targetDoc.r2_key);
  if (!object) {
    return c.json({ error: 'PDFが見つかりません' }, 404);
  }

  const quarterStr = release.fiscal_quarter ? `Q${release.fiscal_quarter}` : '';
  const fileName = `${release.stock_code}_${release.fiscal_year}${quarterStr}_${targetDoc.document_type}.pdf`;

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
    },
  });
});

export default earnings;
