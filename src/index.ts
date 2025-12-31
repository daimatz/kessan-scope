import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import type { Env } from './types';
import auth, { verifyJWT } from './routes/auth';
import watchlist from './routes/watchlist';
import earnings from './routes/earnings';
import chat from './routes/chat';
import users from './routes/users';

const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// CORS設定
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.FRONTEND_URL,
    credentials: true,
  });
  return corsMiddleware(c, next);
});

// ヘルスチェック
app.get('/health', (c) => c.json({ status: 'ok' }));

// 認証ルート（認証不要）
app.route('/api/auth', auth);

// 認証ミドルウェア
app.use('/api/*', async (c, next) => {
  // /api/auth はスキップ
  if (c.req.path.startsWith('/api/auth')) {
    return next();
  }

  const token = getCookie(c, 'auth_token');
  if (!token) {
    return c.json({ error: '認証が必要です' }, 401);
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: '認証が無効です' }, 401);
  }

  c.set('userId', payload.sub);
  return next();
});

// 保護されたルート
app.route('/api/watchlist', watchlist);
app.route('/api/earnings', earnings);
app.route('/api/chat', chat);
app.route('/api/users', users);

// 404ハンドラ
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// エラーハンドラ
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
