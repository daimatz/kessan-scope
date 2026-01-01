import { Hono } from 'hono';
import type { Env, EarningsSummary } from '../types';
import { getChatMessages, addChatMessage, getEarningsById, getUserById } from '../db/queries';
import { OpenAIService } from '../services/openai';

const chat = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// チャット履歴取得
chat.get('/:earningsId', async (c) => {
  const userId = c.get('userId');
  const earningsId = c.req.param('earningsId');

  const messages = await getChatMessages(c.env.DB, userId, earningsId);

  return c.json({ messages });
});

// チャット送信
chat.post('/:earningsId', async (c) => {
  const userId = c.get('userId');
  const earningsId = c.req.param('earningsId');
  const body = await c.req.json<{ message: string }>();

  if (!body.message || body.message.trim().length === 0) {
    return c.json({ error: 'メッセージを入力してください' }, 400);
  }

  // 決算データを取得
  const earnings = await getEarningsById(c.env.DB, earningsId);
  if (!earnings) {
    return c.json({ error: '決算データが見つかりません' }, 404);
  }

  // ユーザー設定を取得
  const user = await getUserById(c.env.DB, userId);
  if (!user) {
    return c.json({ error: 'ユーザーが見つかりません' }, 404);
  }

  // 既存のチャット履歴を取得
  const existingMessages = await getChatMessages(c.env.DB, userId, earningsId);

  // ユーザーメッセージを保存
  const userMessage = await addChatMessage(c.env.DB, {
    user_id: userId,
    earnings_id: earningsId,
    role: 'user',
    content: body.message,
  });

  // 決算サマリーをパース
  let summary: EarningsSummary | null = null;
  if (earnings.summary) {
    try {
      summary = JSON.parse(earnings.summary);
    } catch {
      // ignore
    }
  }

  if (!summary) {
    return c.json({ error: '決算サマリーがありません' }, 400);
  }

  // OpenAIで回答を生成
  const openai = new OpenAIService(c.env.OPENAI_API_KEY, user.openai_model);
  const assistantContent = await openai.chat(
    summary,
    existingMessages.map(m => ({ role: m.role, content: m.content })),
    body.message
  );

  // アシスタントメッセージを保存
  const assistantMessage = await addChatMessage(c.env.DB, {
    user_id: userId,
    earnings_id: earningsId,
    role: 'assistant',
    content: assistantContent,
  });

  return c.json({
    userMessage,
    assistantMessage,
  });
});

export default chat;
