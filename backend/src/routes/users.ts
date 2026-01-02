import { Hono } from 'hono';
import type { Env } from '../types';
import { updateUserSettings } from '../db/queries';

const users = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// ユーザー設定更新
users.patch('/settings', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    name?: string;
  }>();

  await updateUserSettings(c.env.DB, userId, {
    name: body.name,
  });

  return c.json({ success: true });
});

export default users;
