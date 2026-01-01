import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import type { Env, GoogleUserInfo, JWTPayload } from '../types';
import { getUserByGoogleId, createUser, getUserById, getUserByEmail, createUserWithPassword, verifyPassword, setUserPassword, linkGoogleAccount, verifyEmailToken, regenerateVerificationToken, deleteUser } from '../db/queries';
import { MailerSendClient } from '../services/mailersend';

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
  
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      openai_model: user.openai_model,
    },
  });
});

// ログアウト
auth.post('/logout', async (c) => {
  deleteCookie(c, 'auth_token');
  return c.json({ success: true });
});

// メール/パスワードでユーザー登録
auth.post('/register', async (c) => {
  const body = await c.req.json<{ email: string; password: string; name?: string }>();

  if (!body.email || !body.password) {
    return c.json({ error: 'メールアドレスとパスワードは必須です' }, 400);
  }

  // メール形式の簡易バリデーション
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({ error: '無効なメールアドレス形式です' }, 400);
  }

  // パスワードの長さチェック
  if (body.password.length < 8) {
    return c.json({ error: 'パスワードは8文字以上です' }, 400);
  }

  // 既存ユーザーのチェック
  const existingUser = await getUserByEmail(c.env.DB, body.email);

  if (existingUser) {
    // 既存ユーザーがいる場合、パスワードが設定されているか確認
    if (existingUser.password_hash) {
      // 未確認ユーザーの場合は再送を促す
      if (!existingUser.email_verified) {
        return c.json({ error: 'このメールアドレスは確認待ちです。確認メールをご確認ください。', requiresVerification: true, email: existingUser.email }, 409);
      }
      return c.json({ error: 'このメールアドレスは既に登録されています' }, 409);
    }
    // Google Authで作成されたアカウントにパスワードを追加（既にメール確認済み）
    await setUserPassword(c.env.DB, existingUser.id, body.password);

    // JWTを作成（Google Authで既に確認済みなのでログイン可能）
    const jwt = await createJWT(
      {
        sub: existingUser.id,
        email: existingUser.email,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
      },
      c.env.JWT_SECRET
    );

    setCookie(c, 'auth_token', jwt, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 60 * 60 * 24 * 7,
    });

    return c.json({
      user: {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
      },
    }, 201);
  }

  // 新規ユーザー作成
  const { user, verificationToken } = await createUserWithPassword(c.env.DB, {
    email: body.email,
    password: body.password,
    name: body.name || null,
  });

  // 確認メールを送信
  const verificationUrl = `${new URL(c.req.url).origin}/api/auth/verify-email?token=${verificationToken}`;
  const mailer = new MailerSendClient(c.env.MAILERSEND_API_KEY, c.env.MAILERSEND_FROM_EMAIL);

  try {
    await mailer.sendVerificationEmail({
      to: { email: user.email, name: user.name || undefined },
      verificationUrl,
    });
  } catch (error) {
    console.error('Failed to send verification email:', error);
    // メール送信失敗時はユーザーを削除
    await deleteUser(c.env.DB, user.id);
    return c.json({ error: '確認メールの送信に失敗しました。しばらく経ってから再度お試しください。' }, 500);
  }

  return c.json({
    message: '確認メールを送信しました。メールをご確認ください。',
    requiresVerification: true,
  }, 201);
});

// メール/パスワードでログイン
auth.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();

  if (!body.email || !body.password) {
    return c.json({ error: 'メールアドレスとパスワードは必須です' }, 400);
  }

  // ユーザーを取得
  const user = await getUserByEmail(c.env.DB, body.email);
  if (!user) {
    return c.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401);
  }

  // パスワード検証
  const isValid = await verifyPassword(c.env.DB, user.id, body.password);
  if (!isValid) {
    return c.json({ error: 'メールアドレスまたはパスワードが正しくありません' }, 401);
  }

  // メール確認チェック
  if (!user.email_verified) {
    return c.json({ error: 'メールアドレスが確認されていません。確認メールをご確認ください。', requiresVerification: true, email: user.email }, 403);
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
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
});

// 開発用: テストユーザーでログイン
auth.get('/dev-login', async (c) => {
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

// メールアドレス確認
auth.get('/verify-email', async (c) => {
  const token = c.req.query('token');

  if (!token) {
    return c.redirect(`${c.env.FRONTEND_URL}?error=invalid_token`);
  }

  const user = await verifyEmailToken(c.env.DB, token);

  if (!user) {
    return c.redirect(`${c.env.FRONTEND_URL}?error=expired_token`);
  }

  // JWTを作成してログイン状態にする
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
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  // 確認完了後、フロントエンドにリダイレクト
  return c.redirect(`${c.env.FRONTEND_URL}?verified=1`);
});

// 確認メール再送
auth.post('/resend-verification', async (c) => {
  const body = await c.req.json<{ email: string }>();

  if (!body.email) {
    return c.json({ error: 'メールアドレスは必須です' }, 400);
  }

  const user = await getUserByEmail(c.env.DB, body.email);

  if (!user) {
    // セキュリティのため、ユーザーが存在しなくても成功を返す
    return c.json({ message: '確認メールを送信しました' });
  }

  if (user.email_verified) {
    return c.json({ error: 'このメールアドレスは既に確認されています' }, 400);
  }

  // 新しいトークンを生成
  const verificationToken = await regenerateVerificationToken(c.env.DB, user.id);

  // 確認メールを送信
  const verificationUrl = `${new URL(c.req.url).origin}/api/auth/verify-email?token=${verificationToken}`;
  const mailer = new MailerSendClient(c.env.MAILERSEND_API_KEY, c.env.MAILERSEND_FROM_EMAIL);

  try {
    await mailer.sendVerificationEmail({
      to: { email: user.email, name: user.name || undefined },
      verificationUrl,
    });
  } catch (error) {
    console.error('Failed to send verification email:', error);
    return c.json({ error: '確認メールの送信に失敗しました' }, 500);
  }

  return c.json({ message: '確認メールを送信しました' });
});

// JWT検証ミドルウェアをエクスポート
export { verifyJWT };
export default auth;
