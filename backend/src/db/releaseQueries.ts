// リリース関連クエリ（新API）

import type { EarningsRelease, ReleaseType, Earnings } from '../types';
import { generateId } from './utils';

// EarningsRelease を取得または作成
export async function getOrCreateEarningsRelease(
  db: D1Database,
  data: {
    release_type: ReleaseType;
    stock_code: string;
    fiscal_year: string;
    fiscal_quarter: number | null;
  }
): Promise<EarningsRelease> {
  // 既存のリリースを検索
  const existing = await db.prepare(`
    SELECT * FROM earnings_release
    WHERE stock_code = ? AND fiscal_year = ? AND fiscal_quarter IS ? AND release_type = ?
  `).bind(
    data.stock_code,
    data.fiscal_year,
    data.fiscal_quarter,
    data.release_type
  ).first<EarningsRelease>();

  if (existing) {
    return existing;
  }

  // 新規作成
  const id = generateId();
  await db.prepare(`
    INSERT INTO earnings_release (id, release_type, stock_code, fiscal_year, fiscal_quarter)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    id,
    data.release_type,
    data.stock_code,
    data.fiscal_year,
    data.fiscal_quarter
  ).run();

  const release = await getEarningsReleaseById(db, id);
  if (!release) throw new Error('Failed to create earnings release');
  return release;
}

export async function getEarningsReleaseById(db: D1Database, id: string): Promise<EarningsRelease | null> {
  const result = await db.prepare(
    'SELECT * FROM earnings_release WHERE id = ?'
  ).bind(id).first<EarningsRelease>();
  return result;
}

export async function getEarningsReleasesByStockCode(db: D1Database, stockCode: string): Promise<EarningsRelease[]> {
  const result = await db.prepare(`
    SELECT * FROM earnings_release
    WHERE stock_code = ?
    ORDER BY fiscal_year DESC, fiscal_quarter DESC NULLS LAST
  `).bind(stockCode).all<EarningsRelease>();
  return result.results;
}

// リリースに紐づくドキュメント一覧を取得
export async function getDocumentsForRelease(db: D1Database, releaseId: string): Promise<Earnings[]> {
  const result = await db.prepare(`
    SELECT * FROM earnings
    WHERE release_id = ?
    ORDER BY document_type ASC
  `).bind(releaseId).all<Earnings>();
  return result.results;
}

// リリースの分析結果を更新
export async function updateEarningsReleaseAnalysis(db: D1Database, releaseId: string, data: {
  summary?: string | null;
  highlights?: string | null;
  lowlights?: string | null;
}): Promise<void> {
  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: (string | null)[] = [];

  if (data.summary !== undefined) {
    updates.push('summary = ?');
    values.push(data.summary);
  }
  if (data.highlights !== undefined) {
    updates.push('highlights = ?');
    values.push(data.highlights);
  }
  if (data.lowlights !== undefined) {
    updates.push('lowlights = ?');
    values.push(data.lowlights);
  }

  if (values.length === 0) return;

  values.push(releaseId);

  await db.prepare(
    `UPDATE earnings_release SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();
}

// リリース用のユーザー分析型
export interface UserReleaseAnalysis {
  id: string;
  user_id: string;
  release_id: string;
  custom_analysis: string | null;
  custom_prompt_used: string | null;
  notified_at: string | null;
  created_at: string;
}

// リリース用のユーザー分析を取得
export async function getUserAnalysisByRelease(
  db: D1Database,
  userId: string,
  releaseId: string
): Promise<UserReleaseAnalysis | null> {
  const result = await db.prepare(
    'SELECT * FROM user_release_analysis WHERE user_id = ? AND release_id = ?'
  ).bind(userId, releaseId).first<UserReleaseAnalysis>();
  return result;
}

// リリース用のユーザー分析を作成
export async function createUserAnalysisForRelease(db: D1Database, data: {
  user_id: string;
  release_id: string;
  custom_analysis: string | null;
  custom_prompt_used?: string | null;
}): Promise<UserReleaseAnalysis> {
  const id = generateId();
  await db.prepare(
    'INSERT INTO user_release_analysis (id, user_id, release_id, custom_analysis, custom_prompt_used) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, data.user_id, data.release_id, data.custom_analysis, data.custom_prompt_used ?? null).run();

  const analysis = await db.prepare(
    'SELECT * FROM user_release_analysis WHERE id = ?'
  ).bind(id).first<UserReleaseAnalysis>();
  if (!analysis) throw new Error('Failed to create user analysis for release');
  return analysis;
}

// リリース用のユーザー分析を更新
export async function updateUserAnalysisForRelease(
  db: D1Database,
  userId: string,
  releaseId: string,
  customAnalysis: string | null,
  customPromptUsed?: string | null
): Promise<void> {
  await db.prepare(
    'UPDATE user_release_analysis SET custom_analysis = ?, custom_prompt_used = ? WHERE user_id = ? AND release_id = ?'
  ).bind(customAnalysis, customPromptUsed ?? null, userId, releaseId).run();
}

// リリースに紐づくドキュメント数を取得
export async function getDocumentCountForRelease(db: D1Database, releaseId: string): Promise<number> {
  const result = await db.prepare(
    'SELECT COUNT(*) as count FROM earnings WHERE release_id = ?'
  ).bind(releaseId).first<{ count: number }>();
  return result?.count ?? 0;
}

// 過去のリリースを取得（チャットコンテキスト用）
export interface PastReleaseForChat {
  id: string;
  fiscal_year: string;
  fiscal_quarter: number | null;
  summary: string | null;
  highlights: string | null;
  lowlights: string | null;
}

export async function getPastReleasesForChat(
  db: D1Database,
  stockCode: string,
  currentReleaseId: string,
  limit: number = 4
): Promise<PastReleaseForChat[]> {
  const result = await db.prepare(`
    SELECT id, fiscal_year, fiscal_quarter, summary, highlights, lowlights
    FROM earnings_release
    WHERE stock_code = ?
      AND id != ?
      AND release_type = 'quarterly_earnings'
      AND (fiscal_year, COALESCE(fiscal_quarter, 0)) < (
        SELECT fiscal_year, COALESCE(fiscal_quarter, 0)
        FROM earnings_release WHERE id = ?
      )
    ORDER BY fiscal_year DESC, fiscal_quarter DESC
    LIMIT ?
  `).bind(stockCode, currentReleaseId, currentReleaseId, limit).all<PastReleaseForChat>();

  return result.results;
}

// リリース用のカスタム分析履歴型
export interface ReleaseAnalysisHistory {
  id: string;
  user_id: string;
  release_id: string;
  custom_prompt: string;
  analysis: string;
  created_at: string;
}

// リリース用のカスタム分析履歴を保存
export async function saveCustomAnalysisForRelease(
  db: D1Database,
  userId: string,
  releaseId: string,
  customPrompt: string,
  analysis: string
): Promise<void> {
  const id = generateId();
  await db.prepare(
    'INSERT INTO release_analysis_history (id, user_id, release_id, custom_prompt, analysis) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, releaseId, customPrompt, analysis).run();
}

// リリース用のカスタム分析履歴を取得
export async function getCustomAnalysisHistoryForRelease(
  db: D1Database,
  userId: string,
  releaseId: string
): Promise<ReleaseAnalysisHistory[]> {
  const result = await db.prepare(
    'SELECT * FROM release_analysis_history WHERE user_id = ? AND release_id = ? ORDER BY created_at DESC'
  ).bind(userId, releaseId).all<ReleaseAnalysisHistory>();
  return result.results;
}

// ========================================
// バッチクエリ（N+1問題対策）
// ========================================

// 複数リリースのドキュメントを一括取得
export async function getDocumentsForReleases(
  db: D1Database,
  releaseIds: string[]
): Promise<Map<string, Earnings[]>> {
  if (releaseIds.length === 0) return new Map();

  const placeholders = releaseIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT * FROM earnings
    WHERE release_id IN (${placeholders})
    ORDER BY release_id, document_type ASC
  `).bind(...releaseIds).all<Earnings>();

  const map = new Map<string, Earnings[]>();
  for (const doc of result.results) {
    const existing = map.get(doc.release_id) || [];
    existing.push(doc);
    map.set(doc.release_id, existing);
  }
  return map;
}

// 複数リリースのユーザー分析を一括取得
export async function getUserAnalysesForReleases(
  db: D1Database,
  userId: string,
  releaseIds: string[]
): Promise<Map<string, UserReleaseAnalysis>> {
  if (releaseIds.length === 0) return new Map();

  const placeholders = releaseIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT * FROM user_release_analysis
    WHERE user_id = ? AND release_id IN (${placeholders})
  `).bind(userId, ...releaseIds).all<UserReleaseAnalysis>();

  const map = new Map<string, UserReleaseAnalysis>();
  for (const analysis of result.results) {
    map.set(analysis.release_id, analysis);
  }
  return map;
}

// 複数リリースの分析履歴件数を一括取得
export async function getAnalysisHistoryCountsForReleases(
  db: D1Database,
  userId: string,
  releaseIds: string[]
): Promise<Map<string, number>> {
  if (releaseIds.length === 0) return new Map();

  const placeholders = releaseIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT release_id, COUNT(*) as count
    FROM release_analysis_history
    WHERE user_id = ? AND release_id IN (${placeholders})
    GROUP BY release_id
  `).bind(userId, ...releaseIds).all<{ release_id: string; count: number }>();

  const map = new Map<string, number>();
  for (const row of result.results) {
    map.set(row.release_id, row.count);
  }
  return map;
}

// リリース用のキャッシュ済み分析を検索
export async function findCachedAnalysisForRelease(
  db: D1Database,
  userId: string,
  releaseId: string,
  customPrompt: string
): Promise<string | null> {
  // まず現在の分析をチェック
  const current = await db.prepare(
    'SELECT custom_analysis FROM user_release_analysis WHERE user_id = ? AND release_id = ? AND custom_prompt_used = ?'
  ).bind(userId, releaseId, customPrompt).first<{ custom_analysis: string | null }>();

  if (current?.custom_analysis) {
    return current.custom_analysis;
  }

  // 履歴からチェック
  const history = await db.prepare(
    'SELECT analysis FROM release_analysis_history WHERE user_id = ? AND release_id = ? AND custom_prompt = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(userId, releaseId, customPrompt).first<{ analysis: string }>();

  return history?.analysis ?? null;
}
