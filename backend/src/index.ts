import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import type { Env, QueueMessage } from './types';
import auth, { verifyJWT } from './routes/auth';
import watchlist from './routes/watchlist';
import earnings from './routes/earnings';
import chat from './routes/chat';
import users from './routes/users';
import stocks from './routes/stocks';
import valuation from './routes/valuation';
import { updateStockList } from './services/stockUpdater';
import { processImportBatch } from './services/historicalImport';
import { checkNewReleases } from './services/newReleasesChecker';
import { processRegenerateBatch } from './services/regenerateProcessor';

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

// /internal/* は本番環境で無効化
app.use('/internal/*', async (c, next) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Not found' }, 404);
  }
  return next();
});

// 銘柄リスト手動更新（開発用）
app.post('/internal/update-stocks', async (c) => {
  try {
    const result = await updateStockList(c.env);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error('Stock update failed:', error);
    return c.json({ error: 'Failed to update stock list' }, 500);
  }
});

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
app.route('/api/stocks', stocks);
app.route('/api/valuation', valuation);

// 404ハンドラ
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// エラーハンドラ
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Scheduled handler for stock list updates and new releases check
const scheduled: ExportedHandlerScheduledHandler<Env> = async (event, env, ctx) => {
  console.log('Starting scheduled tasks...');

  // 銘柄リスト更新
  try {
    const result = await updateStockList(env);
    console.log(`Stock list updated: ${result.updated}/${result.total} stocks`);
  } catch (error) {
    console.error('Failed to update stock list:', error);
  }

  // TDnet新着決算チェック
  try {
    const result = await checkNewReleases(env);
    console.log(`New releases check: ${result.imported} imported from ${result.checked} stocks`);
  } catch (error) {
    console.error('Failed to check new releases:', error);
  }
};

// Queue handler for historical earnings import and regeneration
const queue: ExportedHandlerQueueHandler<Env, QueueMessage> = async (batch, env) => {
  for (const message of batch.messages) {
    try {
      switch (message.body.type) {
        case 'import_historical_earnings':
          await processImportBatch(env, message.body);
          break;
        case 'regenerate_custom_analysis':
          await processRegenerateBatch(env, message.body);
          break;
        default:
          console.error('Unknown message type:', message.body);
      }
      message.ack();
    } catch (error) {
      console.error('Failed to process queue message:', error);
      message.retry();
    }
  }
};

export default {
  fetch: app.fetch,
  scheduled,
  queue,
};
