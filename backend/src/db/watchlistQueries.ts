// ウォッチリスト関連クエリ

import type { WatchlistItem } from '../types';
import { generateId } from './utils';

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
