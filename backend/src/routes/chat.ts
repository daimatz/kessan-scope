import { Hono } from 'hono';
import type { Env, EarningsSummary } from '../types';
import { getChatMessages, addChatMessage, getEarningsById } from '../db/queries';
import { ClaudeService } from '../services/claude';

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

  // Claudeで回答を生成
  const claude = new ClaudeService(c.env.ANTHROPIC_API_KEY);
  const assistantContent = await claude.chat(
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
