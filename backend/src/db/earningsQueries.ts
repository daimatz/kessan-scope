// 決算関連クエリ

import type { Earnings, DocumentType } from '../types';
import { generateId } from './utils';

// ダッシュボード用: ウォッチリストの銘柄のリリース一覧を取得
export interface ReleaseForDashboard {
  id: string;
  release_type: string;
  stock_code: string;
  stock_name: string | null;
  fiscal_year: string;
  fiscal_quarter: number | null;
  summary: string | null;
}

export async function getReleasesForDashboard(db: D1Database, userId: string): Promise<ReleaseForDashboard[]> {
  const result = await db.prepare(`
    SELECT er.*, w.stock_name
    FROM earnings_release er
    INNER JOIN watchlist w ON er.stock_code = w.stock_code AND w.user_id = ?
    ORDER BY er.fiscal_year DESC, er.fiscal_quarter DESC NULLS LAST
    LIMIT 50
  `).bind(userId).all<ReleaseForDashboard>();
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

export async function getEarningsByStockCode(db: D1Database, stockCode: string): Promise<Earnings[]> {
  const result = await db.prepare(
    'SELECT * FROM earnings WHERE stock_code = ? ORDER BY announcement_date DESC'
  ).bind(stockCode).all<Earnings>();
  return result.results;
}

// Earnings 作成（release_id と document_type 付き）
export async function createEarningsWithRelease(db: D1Database, data: {
  stock_code: string;
  fiscal_year: string;
  fiscal_quarter: number;
  announcement_date: string;
  content_hash: string | null;
  r2_key: string | null;
  document_url: string | null;
  document_title: string | null;
  release_id: string;
  document_type: DocumentType;
}): Promise<Earnings> {
  const id = generateId();

  await db.prepare(
    `INSERT INTO earnings (id, stock_code, fiscal_year, fiscal_quarter, announcement_date, content_hash, r2_key, document_title, release_id, document_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    data.stock_code,
    data.fiscal_year,
    data.fiscal_quarter,
    data.announcement_date,
    data.content_hash,
    data.r2_key,
    data.document_title,
    data.release_id,
    data.document_type
  ).run();

  // URL インデックスに追加
  if (data.document_url) {
    await addDocumentUrl(db, id, data.document_url);
  }

  const earnings = await getEarningsById(db, id);
  if (!earnings) throw new Error('Failed to create earnings');
  return earnings;
}
