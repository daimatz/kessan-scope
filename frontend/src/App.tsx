import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authAPI, APIError } from './api';
import Dashboard from './pages/Dashboard';
import Watchlist from './pages/Watchlist';
import StockDetail from './pages/StockDetail';
import ReleaseDetail from './pages/ReleaseDetail';
import Settings from './pages/Settings';
import Layout from './components/Layout';
import './App.css';

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [showLinkPasswordConfirm, setShowLinkPasswordConfirm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['auth'],
    queryFn: authAPI.getMe,
  });

  const loginMutation = useMutation({
    mutationFn: authAPI.login,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      setError('');
      setVerificationEmail(null);
    },
    onError: (err: Error) => {
      setError(err.message);
      if (err instanceof APIError && err.requiresVerification && err.email) {
        setVerificationEmail(err.email);
      } else {
        setVerificationEmail(null);
      }
    },
  });

  const registerMutation = useMutation({
    mutationFn: authAPI.register,
    onSuccess: (data) => {
      if (data.existingGoogleAccount) {
        setShowLinkPasswordConfirm(true);
        setError('');
        setSuccessMessage('');
      } else if (data.requiresVerification) {
        setSuccessMessage('確認メールを送信しました。24時間以内にメールをご確認ください。');
        setError('');
        setShowLinkPasswordConfirm(false);
      } else {
        queryClient.invalidateQueries({ queryKey: ['auth'] });
        setError('');
        setSuccessMessage('');
        setShowLinkPasswordConfirm(false);
      }
    },
    onError: (err: Error) => {
      setError(err.message);
      setSuccessMessage('');
      setShowLinkPasswordConfirm(false);
      if (err instanceof APIError && err.requiresVerification && err.email) {
        setVerificationEmail(err.email);
      } else {
        setVerificationEmail(null);
      }
    },
  });

  const resendMutation = useMutation({
    mutationFn: authAPI.resendVerification,
    onSuccess: () => {
      setSuccessMessage('確認メールを再送しました。24時間以内にメールをご確認ください。');
      setError('');
      setVerificationEmail(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'login') {
      loginMutation.mutate({ email, password });
    } else {
      registerMutation.mutate({ email, password, name: name || undefined });
    }
  };

  const isPending = loginMutation.isPending || registerMutation.isPending || resendMutation.isPending;

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (!data?.user) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>📈 Stock Watcher</h1>
          <p className="login-description">日本株の決算を自動でウォッチし、LLMで分析</p>
          
          <div className="auth-tabs">
            <button
              className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
              onClick={() => { setMode('login'); setError(''); setSuccessMessage(''); setVerificationEmail(null); setShowLinkPasswordConfirm(false); }}
            >
              ログイン
            </button>
            <button
              className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
              onClick={() => { setMode('register'); setError(''); setSuccessMessage(''); setVerificationEmail(null); setShowLinkPasswordConfirm(false); }}
            >
              新規登録
            </button>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {mode === 'register' && (
              <input
                type="text"
                placeholder="名前（任意）"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
              />
            )}
            <input
              type="email"
              placeholder="メールアドレス"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isPending}
            />
            <input
              type="password"
              placeholder="パスワード（8文字以上）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={isPending}
            />
            {error && (
              <div className="auth-error">
                {error}
                {verificationEmail && (
                  <button
                    type="button"
                    className="resend-link"
                    onClick={() => resendMutation.mutate(verificationEmail)}
                    disabled={resendMutation.isPending}
                  >
                    {resendMutation.isPending ? '送信中...' : '確認メールを再送する'}
                  </button>
                )}
              </div>
            )}
            {successMessage && <div className="auth-success">{successMessage}</div>}
            {showLinkPasswordConfirm && (
              <div className="link-password-confirm">
                <p>Googleログインで登録済みのアカウントです。<br />パスワードを設定しますか？</p>
                <div className="link-password-buttons">
                  <button
                    type="button"
                    className="link-password-yes"
                    onClick={() => {
                      registerMutation.mutate({ email, password, name: name || undefined, confirmLinkPassword: true });
                    }}
                    disabled={isPending}
                  >
                    はい、設定する
                  </button>
                  <button
                    type="button"
                    className="link-password-no"
                    onClick={() => setShowLinkPasswordConfirm(false)}
                    disabled={isPending}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
            {!showLinkPasswordConfirm && (
              <button type="submit" className="auth-submit" disabled={isPending || !!successMessage}>
                {isPending ? '処理中...' : mode === 'login' ? 'ログイン' : '登録'}
              </button>
            )}
          </form>

          <div className="auth-divider">
            <span>または</span>
          </div>

          <a href={authAPI.getGoogleAuthUrl()} className="google-login-btn">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Googleでログイン
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGuard>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/stocks/:code" element={<StockDetail />} />
              <Route path="/releases/:releaseId" element={<ReleaseDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </AuthGuard>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
