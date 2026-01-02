// チャット関連クエリ

import type { ChatMessage } from '../types';
import { generateId } from './utils';

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
