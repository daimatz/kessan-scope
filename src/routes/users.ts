import { Hono } from 'hono';
import type { Env } from '../types';
import { updateUserSettings } from '../db/queries';

const users = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// ユーザー設定更新
users.patch('/settings', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    openai_model?: string;
    name?: string;
  }>();

  // 許可されたモデルのリスト
  const allowedModels = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o1-preview',
  ];

  if (body.openai_model && !allowedModels.includes(body.openai_model)) {
    return c.json({ error: '無効なモデルです' }, 400);
  }

  await updateUserSettings(c.env.DB, userId, {
    openai_model: body.openai_model,
    name: body.name,
  });

  return c.json({ success: true });
});

export default users;
