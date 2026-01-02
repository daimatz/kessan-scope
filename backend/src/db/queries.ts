import type { User, WatchlistItem, Earnings, UserEarningsAnalysis, ChatMessage, CustomAnalysisHistory } from '../types';

export function generateId(): string {
  return crypto.randomUUID();
}

// パスワードハッシュ生成
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// User queries
export async function getUserByGoogleId(db: D1Database, googleId: string): Promise<User | null> {
  const result = await db.prepare(
    'SELECT * FROM users WHERE google_id = ?'
  ).bind(googleId).first<User>();
  return result;
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const result = await db.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(id).first<User>();
  return result;
}

export async function createUser(db: D1Database, data: {
  google_id: string;
  email: string;
  name: string | null;
}): Promise<User> {
  const id = generateId();
  await db.prepare(
    'INSERT INTO users (id, google_id, email, name, email_verified) VALUES (?, ?, ?, ?, 1)'
  ).bind(id, data.google_id, data.email, data.name).run();

  const user = await getUserById(db, id);
  if (!user) throw new Error('Failed to create user');
  return user;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const result = await db.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first<User>();
  return result;
}

export async function deleteUser(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
}

export function generateVerificationToken(): string {
  return crypto.randomUUID();
}

export async function createUserWithPassword(db: D1Database, data: {
  email: string;
  password: string;
  name: string | null;
}): Promise<{ user: User; verificationToken: string }> {
  const id = generateId();
  const passwordHash = await hashPassword(data.password);
  const verificationToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24時間後

  await db.prepare(
    `INSERT INTO users (id, email, name, password_hash, email_verified, email_verification_token, email_verification_expires_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).bind(id, data.email, data.name, passwordHash, verificationToken, expiresAt).run();

  const user = await getUserById(db, id);
  if (!user) throw new Error('Failed to create user');
  return { user, verificationToken };
}

export async function verifyEmailToken(db: D1Database, token: string): Promise<User | null> {
  const user = await db.prepare(
    'SELECT * FROM users WHERE email_verification_token = ?'
  ).bind(token).first<User>();

  if (!user) return null;

  // トークンの有効期限をチェック
  if (user.email_verification_expires_at) {
    const expiresAt = new Date(user.email_verification_expires_at);
    if (expiresAt < new Date()) return null;
  }

  // メール確認済みに更新
  await db.prepare(
    `UPDATE users SET email_verified = 1, email_verification_token = NULL, email_verification_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(user.id).run();

  return await getUserById(db, user.id);
}

export async function regenerateVerificationToken(db: D1Database, userId: string): Promise<string> {
  const verificationToken = generateVerificationToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(
    `UPDATE users SET email_verification_token = ?, email_verification_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(verificationToken, expiresAt, userId).run();

  return verificationToken;
}

export async function verifyPassword(db: D1Database, userId: string, password: string): Promise<boolean> {
  const result = await db.prepare(
    'SELECT password_hash FROM users WHERE id = ?'
  ).bind(userId).first<{ password_hash: string | null }>();
  
  if (!result || !result.password_hash) {
    return false;
  }
  
  const inputHash = await hashPassword(password);
  return result.password_hash === inputHash;
}

export async function setUserPassword(db: D1Database, userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db.prepare(
    'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(passwordHash, userId).run();
}

export async function linkGoogleAccount(db: D1Database, userId: string, googleId: string): Promise<void> {
  await db.prepare(
    'UPDATE users SET google_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(googleId, userId).run();
}

export async function updateUserSettings(db: D1Database, userId: string, data: {
  name?: string;
}): Promise<void> {
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    values.push(data.name);
  }

  if (updates.length === 0) return;

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(userId);

  await db.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();
}

// Watchlist queries
export async function getWatchlist(db: D1Database, userId: string): Promise<WatchlistItem[]> {
  const result = await db.prepare(
    'SELECT * FROM watchlist WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all<WatchlistItem>();
  return result.results;
}

export async function addToWatchlist(db: D1Database, data: {
  user_id: string;
  stock_code: string;
  stock_name: string | null;
  custom_prompt: string | null;
}): Promise<WatchlistItem> {
  const id = generateId();
  await db.prepare(
    'INSERT INTO watchlist (id, user_id, stock_code, stock_name, custom_prompt) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, data.user_id, data.stock_code, data.stock_name, data.custom_prompt).run();
  
  const item = await db.prepare('SELECT * FROM watchlist WHERE id = ?').bind(id).first<WatchlistItem>();
  if (!item) throw new Error('Failed to add to watchlist');
  return item;
}

export async function removeFromWatchlist(db: D1Database, id: string, userId: string): Promise<boolean> {
  const result = await db.prepare(
    'DELETE FROM watchlist WHERE id = ? AND user_id = ?'
  ).bind(id, userId).run();
  return result.meta.changes > 0;
}

export async function updateWatchlistItem(db: D1Database, id: string, userId: string, data: {
  custom_prompt?: string | null;
  stock_name?: string | null;
}): Promise<boolean> {
  const updates: string[] = [];
  const values: (string | null)[] = [];
  
  if (data.custom_prompt !== undefined) {
    updates.push('custom_prompt = ?');
    values.push(data.custom_prompt);
  }
  if (data.stock_name !== undefined) {
    updates.push('stock_name = ?');
    values.push(data.stock_name);
  }
  
  if (updates.length === 0) return false;
  
  values.push(id, userId);
  
  const result = await db.prepare(
    `UPDATE watchlist SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`
  ).bind(...values).run();
  return result.meta.changes > 0;
}

export async function getWatchlistByStockCode(db: D1Database, stockCode: string): Promise<WatchlistItem[]> {
  const result = await db.prepare(
    'SELECT * FROM watchlist WHERE stock_code = ?'
  ).bind(stockCode).all<WatchlistItem>();
  return result.results;
}

// Earnings queries
export async function getEarnings(db: D1Database, stockCode: string): Promise<Earnings[]> {
  const result = await db.prepare(
    'SELECT * FROM earnings WHERE stock_code = ? ORDER BY announcement_date DESC'
  ).bind(stockCode).all<Earnings>();
  return result.results;
}

export async function getEarningsById(db: D1Database, id: string): Promise<Earnings | null> {
  const result = await db.prepare(
    'SELECT * FROM earnings WHERE id = ?'
  ).bind(id).first<Earnings>();
  return result;
}

export async function createEarnings(db: D1Database, data: {
  stock_code: string;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  content_hash: string | null;
  r2_key: string | null;
  document_url: string | null;
  document_title: string | null;
}): Promise<Earnings> {
  const id = generateId();

  await db.prepare(
    `INSERT INTO earnings (id, stock_code, fiscal_year, fiscal_quarter, announcement_date, content_hash, r2_key, document_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    data.stock_code,
    data.fiscal_year,
    data.fiscal_quarter,
    data.announcement_date,
    data.content_hash,
    data.r2_key,
    data.document_title
  ).run();

  // URL インデックスに追加
  if (data.document_url) {
    await addDocumentUrl(db, id, data.document_url);
  }

  const earnings = await getEarningsById(db, id);
  if (!earnings) throw new Error('Failed to create earnings');
  return earnings;
}

// URL インデックスに追加
export async function addDocumentUrl(db: D1Database, earningsId: string, url: string): Promise<void> {
  await db.prepare(
    'INSERT OR IGNORE INTO document_url_index (url, earnings_id) VALUES (?, ?)'
  ).bind(url, earningsId).run();
}

// URL が既に登録されているかチェック
export async function checkUrlExists(db: D1Database, url: string): Promise<string | null> {
  const result = await db.prepare(
    'SELECT earnings_id FROM document_url_index WHERE url = ?'
  ).bind(url).first<{ earnings_id: string }>();
  return result?.earnings_id ?? null;
}

// 既存の content_hash 一覧を取得（銘柄単位）
export async function getExistingContentHashes(db: D1Database, stockCode: string): Promise<Set<string>> {
  const result = await db.prepare(
    'SELECT content_hash FROM earnings WHERE stock_code = ? AND content_hash IS NOT NULL'
  ).bind(stockCode).all<{ content_hash: string }>();
  return new Set(result.results.map(r => r.content_hash));
}

export async function updateEarningsAnalysis(db: D1Database, id: string, data: {
  raw_data?: string;
  summary?: string;
  highlights?: string;
  lowlights?: string;
}): Promise<void> {
  const updates: string[] = [];
  const values: (string | null)[] = [];
  
  if (data.raw_data !== undefined) {
    updates.push('raw_data = ?');
    values.push(data.raw_data);
  }
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
  
  if (updates.length === 0) return;
  
  values.push(id);
  
  await db.prepare(
    `UPDATE earnings SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();
}

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

// Watchlist item by ID
export async function getWatchlistItemById(
  db: D1Database,
  id: string,
  userId: string
): Promise<WatchlistItem | null> {
  const result = await db.prepare(
    'SELECT * FROM watchlist WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first<WatchlistItem>();
  return result;
}

// Get all earnings for a stock
export async function getEarningsByStockCode(db: D1Database, stockCode: string): Promise<Earnings[]> {
  const result = await db.prepare(
    'SELECT * FROM earnings WHERE stock_code = ? ORDER BY announcement_date DESC'
  ).bind(stockCode).all<Earnings>();
  return result.results;
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
