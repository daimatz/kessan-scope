import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import type { Env, GoogleUserInfo, JWTPayload } from '../types';
import { getUserByGoogleId, createUser, getUserById, getUserByEmail, linkGoogleAccount } from '../db/queries';
import { UserSchema } from '@kessan-scope/shared';

const auth = new Hono<{ Bindings: Env }>();

// JWTユーティリティ
async function createJWT(payload: JWTPayload, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '');
  
  const data = `${encodedHeader}.${encodedPayload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  return `${data}.${encodedSignature}`;
}

async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
    
    const data = `${encodedHeader}.${encodedPayload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = Uint8Array.from(atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data));
    
    if (!valid) return null;
    
    const payload = JSON.parse(atob(encodedPayload)) as JWTPayload;
    if (payload.exp < Date.now() / 1000) return null;
    
    return payload;
  } catch {
    return null;
  }
}

// Google OAuth URLを生成
function getGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Google OAuth開始
auth.get('/google', async (c) => {
  const state = crypto.randomUUID();
  const redirectUri = new URL('/api/auth/callback', c.req.url).toString();
  
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 600, // 10 minutes
  });
  
  const authUrl = getGoogleAuthUrl(c.env.GOOGLE_CLIENT_ID, redirectUri, state);
  return c.redirect(authUrl);
});

// OAuthコールバック
auth.get('/callback', async (c) => {
  const { code, state } = c.req.query();
  const savedState = getCookie(c, 'oauth_state');
  
  deleteCookie(c, 'oauth_state');
  
  if (!code || !state || state !== savedState) {
    return c.json({ error: 'Invalid state' }, 400);
  }
  
  const redirectUri = new URL('/api/auth/callback', c.req.url).toString();
  
  // アクセストークンを取得
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  
  if (!tokenResponse.ok) {
    return c.json({ error: 'Failed to get token' }, 400);
  }
  
  const tokenData = await tokenResponse.json() as { access_token: string };
  
  // ユーザー情報を取得
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  
  if (!userResponse.ok) {
    return c.json({ error: 'Failed to get user info' }, 400);
  }
  
  const googleUser = await userResponse.json() as GoogleUserInfo;
  
  // ユーザーを検索または作成
  let user = await getUserByGoogleId(c.env.DB, googleUser.id);
  if (!user) {
    // Google IDで見つからない場合、メールで検索
    const existingUserByEmail = await getUserByEmail(c.env.DB, googleUser.email);
    if (existingUserByEmail) {
      // 既存ユーザーにGoogleアカウントを紐付け
      await linkGoogleAccount(c.env.DB, existingUserByEmail.id, googleUser.id);
      user = { ...existingUserByEmail, google_id: googleUser.id };
    } else {
      // 新規ユーザー作成
      user = await createUser(c.env.DB, {
        google_id: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
      });
    }
  }
  
  // JWTを作成
  const jwt = await createJWT(
    {
      sub: user.id,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
    },
    c.env.JWT_SECRET
  );
  
  setCookie(c, 'auth_token', jwt, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  
  return c.redirect(c.env.FRONTEND_URL);
});

// 現在のユーザー情報
auth.get('/me', async (c) => {
  const token = getCookie(c, 'auth_token');
  if (!token) {
    return c.json({ user: null });
  }
  
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) {
    deleteCookie(c, 'auth_token');
    return c.json({ user: null });
  }
  
  const user = await getUserById(c.env.DB, payload.sub);
  if (!user) {
    deleteCookie(c, 'auth_token');
    return c.json({ user: null });
  }
  
  // zod で API レスポンス用にフィルタリング
  return c.json({ user: UserSchema.parse(user) });
});

// ログアウト
auth.post('/logout', async (c) => {
  deleteCookie(c, 'auth_token');
  return c.json({ success: true });
});

// 開発用: テストユーザーでログイン（本番環境では無効）
auth.get('/dev-login', async (c) => {
  // 本番環境では無効化
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Not found' }, 404);
  }

  // テストユーザーを検索または作成
  let user = await getUserByGoogleId(c.env.DB, 'dev-user-123');
  if (!user) {
    user = await createUser(c.env.DB, {
      google_id: 'dev-user-123',
      email: 'dev@example.com',
      name: '開発ユーザー',
    });
  }

  // JWTを作成
  const jwt = await createJWT(
    {
      sub: user.id,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    },
    c.env.JWT_SECRET
  );

  setCookie(c, 'auth_token', jwt, {
    httpOnly: true,
    secure: false, // 開発環境用
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.redirect(c.env.FRONTEND_URL);
});

// JWT検証ミドルウェアをエクスポート
export { verifyJWT };
export default auth;
