import type { User, WatchlistItem, Earnings, UserEarningsAnalysis, ChatMessage } from '../types';

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
    'INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)'
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

export async function createUserWithPassword(db: D1Database, data: {
  email: string;
  password: string;
  name: string | null;
}): Promise<User> {
  const id = generateId();
  const passwordHash = await hashPassword(data.password);
  
  await db.prepare(
    'INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)'
  ).bind(id, data.email, data.name, passwordHash).run();
  
  const user = await getUserById(db, id);
  if (!user) throw new Error('Failed to create user');
  return user;
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
  openai_model?: string;
  name?: string;
}): Promise<void> {
  const updates: string[] = [];
  const values: (string | null)[] = [];
  
  if (data.openai_model !== undefined) {
    updates.push('openai_model = ?');
    values.push(data.openai_model);
  }
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
    'SELECT w.*, u.openai_model FROM watchlist w JOIN users u ON w.user_id = u.id WHERE w.stock_code = ?'
  ).bind(stockCode).all<WatchlistItem & { openai_model: string }>();
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
  edinet_doc_id: string | null;
}): Promise<Earnings> {
  const id = generateId();
  await db.prepare(
    `INSERT INTO earnings (id, stock_code, fiscal_year, fiscal_quarter, announcement_date, edinet_doc_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, data.stock_code, data.fiscal_year, data.fiscal_quarter, data.announcement_date, data.edinet_doc_id).run();
  
  const earnings = await getEarningsById(db, id);
  if (!earnings) throw new Error('Failed to create earnings');
  return earnings;
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
}): Promise<UserEarningsAnalysis> {
  const id = generateId();
  await db.prepare(
    'INSERT INTO user_earnings_analysis (id, user_id, earnings_id, custom_analysis) VALUES (?, ?, ?, ?)'
  ).bind(id, data.user_id, data.earnings_id, data.custom_analysis).run();
  
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
