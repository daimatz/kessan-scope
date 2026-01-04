// ユーザー関連クエリ

import type { User } from '../types';
import { generateId } from './utils';

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
