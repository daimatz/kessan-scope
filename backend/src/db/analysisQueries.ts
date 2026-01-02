// 分析・チャット関連クエリ

import type { UserEarningsAnalysis, ChatMessage, CustomAnalysisHistory } from '../types';
import { generateId } from './utils';

// User earnings analysis queries
export async function getUserEarningsAnalysis(
  db: D1Database,
  userId: string,
  earningsId: string
): Promise<UserEarningsAnalysis | null> {
  const result = await db.prepare(
    'SELECT * FROM user_earnings_analysis WHERE user_id = ? AND earnings_id = ?'
  ).bind(userId, earningsId).first<UserEarningsAnalysis>();
  return result;
}

export async function createUserEarningsAnalysis(db: D1Database, data: {
  user_id: string;
  earnings_id: string;
  custom_analysis: string | null;
  custom_prompt_used?: string | null;
}): Promise<UserEarningsAnalysis> {
  const id = generateId();
  await db.prepare(
    'INSERT INTO user_earnings_analysis (id, user_id, earnings_id, custom_analysis, custom_prompt_used) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, data.user_id, data.earnings_id, data.custom_analysis, data.custom_prompt_used ?? null).run();

  const analysis = await db.prepare(
    'SELECT * FROM user_earnings_analysis WHERE id = ?'
  ).bind(id).first<UserEarningsAnalysis>();
  if (!analysis) throw new Error('Failed to create user earnings analysis');
  return analysis;
}

export async function markAsNotified(db: D1Database, id: string): Promise<void> {
  await db.prepare(
    'UPDATE user_earnings_analysis SET notified_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(id).run();
}

// Chat queries
export async function getChatMessages(
  db: D1Database,
  userId: string,
  earningsId: string
): Promise<ChatMessage[]> {
  const result = await db.prepare(
    'SELECT * FROM chat_messages WHERE user_id = ? AND earnings_id = ? ORDER BY created_at ASC'
  ).bind(userId, earningsId).all<ChatMessage>();
  return result.results;
}

export async function addChatMessage(db: D1Database, data: {
  user_id: string;
  earnings_id: string;
  role: 'user' | 'assistant';
  content: string;
}): Promise<ChatMessage> {
  const id = generateId();
  await db.prepare(
    'INSERT INTO chat_messages (id, user_id, earnings_id, role, content) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, data.user_id, data.earnings_id, data.role, data.content).run();

  const message = await db.prepare(
    'SELECT * FROM chat_messages WHERE id = ?'
  ).bind(id).first<ChatMessage>();
  if (!message) throw new Error('Failed to add chat message');
  return message;
}

// リリース用のチャットメッセージを取得
export async function getChatMessagesByRelease(
  db: D1Database,
  userId: string,
  releaseId: string
): Promise<ChatMessage[]> {
  const result = await db.prepare(
    'SELECT * FROM chat_messages WHERE user_id = ? AND release_id = ? ORDER BY created_at ASC'
  ).bind(userId, releaseId).all<ChatMessage>();
  return result.results;
}

// リリース用のチャットメッセージを追加
export async function addChatMessageForRelease(db: D1Database, data: {
  user_id: string;
  release_id: string;
  role: 'user' | 'assistant';
  content: string;
}): Promise<ChatMessage> {
  const id = generateId();
  await db.prepare(
    'INSERT INTO chat_messages (id, user_id, release_id, role, content) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, data.user_id, data.release_id, data.role, data.content).run();

  const message = await db.prepare(
    'SELECT * FROM chat_messages WHERE id = ?'
  ).bind(id).first<ChatMessage>();
  if (!message) throw new Error('Failed to add chat message');
  return message;
}

// Custom analysis history queries
export async function saveCustomAnalysisToHistory(
  db: D1Database,
  userId: string,
  earningsId: string,
  customPrompt: string,
  analysis: string
): Promise<void> {
  const id = generateId();
  await db.prepare(
    'INSERT INTO custom_analysis_history (id, user_id, earnings_id, custom_prompt, analysis) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, earningsId, customPrompt, analysis).run();
}

export async function getCustomAnalysisHistory(
  db: D1Database,
  userId: string,
  earningsId: string
): Promise<CustomAnalysisHistory[]> {
  const result = await db.prepare(
    'SELECT * FROM custom_analysis_history WHERE user_id = ? AND earnings_id = ? ORDER BY created_at DESC'
  ).bind(userId, earningsId).all<CustomAnalysisHistory>();
  return result.results;
}

// Update existing user earnings analysis
export async function updateUserEarningsAnalysis(
  db: D1Database,
  userId: string,
  earningsId: string,
  customAnalysis: string | null,
  customPromptUsed?: string | null
): Promise<void> {
  await db.prepare(
    'UPDATE user_earnings_analysis SET custom_analysis = ?, custom_prompt_used = ? WHERE user_id = ? AND earnings_id = ?'
  ).bind(customAnalysis, customPromptUsed ?? null, userId, earningsId).run();
}

// 履歴から同じプロンプトでの分析結果を検索
export async function findCachedAnalysis(
  db: D1Database,
  userId: string,
  earningsId: string,
  customPrompt: string
): Promise<string | null> {
  // まず現在の分析をチェック
  const current = await db.prepare(
    'SELECT custom_analysis FROM user_earnings_analysis WHERE user_id = ? AND earnings_id = ? AND custom_prompt_used = ?'
  ).bind(userId, earningsId, customPrompt).first<{ custom_analysis: string | null }>();

  if (current?.custom_analysis) {
    return current.custom_analysis;
  }

  // 履歴からチェック
  const history = await db.prepare(
    'SELECT analysis FROM custom_analysis_history WHERE user_id = ? AND earnings_id = ? AND custom_prompt = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(userId, earningsId, customPrompt).first<{ analysis: string }>();

  return history?.analysis ?? null;
}

// 銘柄に対するユニークなプロンプト一覧を取得
export async function getUniquePromptsForStock(
  db: D1Database,
  userId: string,
  stockCode: string
): Promise<string[]> {
  // user_earnings_analysis と custom_analysis_history の両方からプロンプトを取得
  const result = await db.prepare(`
    SELECT DISTINCT prompt FROM (
      SELECT uea.custom_prompt_used as prompt
      FROM user_earnings_analysis uea
      INNER JOIN earnings e ON uea.earnings_id = e.id
      WHERE uea.user_id = ? AND e.stock_code = ? AND uea.custom_prompt_used IS NOT NULL
      UNION
      SELECT cah.custom_prompt as prompt
      FROM custom_analysis_history cah
      INNER JOIN earnings e ON cah.earnings_id = e.id
      WHERE cah.user_id = ? AND e.stock_code = ?
    )
    ORDER BY prompt
  `).bind(userId, stockCode, userId, stockCode).all<{ prompt: string }>();

  return result.results.map(r => r.prompt);
}

// 決算資料に対するすべての分析を取得（プロンプトごと）
export interface AnalysisByPrompt {
  prompt: string;
  analysis: string;
  created_at: string;
}

export async function getAllAnalysesForEarnings(
  db: D1Database,
  userId: string,
  earningsId: string
): Promise<AnalysisByPrompt[]> {
  // user_earnings_analysis と custom_analysis_history の両方から取得
  // 同じプロンプトがある場合は最新のものを使用
  const result = await db.prepare(`
    SELECT prompt, analysis, created_at FROM (
      SELECT
        uea.custom_prompt_used as prompt,
        uea.custom_analysis as analysis,
        uea.created_at,
        1 as priority
      FROM user_earnings_analysis uea
      WHERE uea.user_id = ? AND uea.earnings_id = ? AND uea.custom_prompt_used IS NOT NULL AND uea.custom_analysis IS NOT NULL
      UNION ALL
      SELECT
        cah.custom_prompt as prompt,
        cah.analysis,
        cah.created_at,
        2 as priority
      FROM custom_analysis_history cah
      WHERE cah.user_id = ? AND cah.earnings_id = ?
    )
    GROUP BY prompt
    ORDER BY created_at DESC
  `).bind(userId, earningsId, userId, earningsId).all<AnalysisByPrompt>();

  return result.results;
}

// 過去の決算を取得（チャットコンテキスト用、直近N件）
export interface PastEarningsForChat {
  id: string;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  summary: string | null;
  highlights: string | null;
  lowlights: string | null;
}

export async function getPastEarningsForChat(
  db: D1Database,
  stockCode: string,
  currentEarningsId: string,
  limit: number = 4
): Promise<PastEarningsForChat[]> {
  // 現在の決算より古い決算を取得（announcement_date順）
  const result = await db.prepare(`
    SELECT id, fiscal_year, fiscal_quarter, announcement_date, summary, highlights, lowlights
    FROM earnings
    WHERE stock_code = ?
      AND id != ?
      AND announcement_date < (SELECT announcement_date FROM earnings WHERE id = ?)
    ORDER BY announcement_date DESC
    LIMIT ?
  `).bind(stockCode, currentEarningsId, currentEarningsId, limit).all<PastEarningsForChat>();

  return result.results;
}
