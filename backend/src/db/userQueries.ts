// ユーザー関連クエリ

import type { User } from '../types';
import { generateId, hashPassword, verifyPasswordHash } from './utils';

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

  return verifyPasswordHash(password, result.password_hash);
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
