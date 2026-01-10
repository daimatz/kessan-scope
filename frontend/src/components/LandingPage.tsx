import { authAPI } from '../api';

export default function LandingPage() {
  return (
    <div className="landing">
      {/* Hero Section */}
      <section className="landing-hero">
        <div className="landing-hero-content">
          <h1 className="landing-title">
            上場企業の決算発表を
            <br />
            AIがリアルタイムで分析
          </h1>
          <p className="landing-subtitle">
            ウォッチリストに登録するだけで、決算発表を自動検知。
            <br />
            AIが経営戦略視点からハイライト・ローライトを抽出してお届けします。
          </p>
          <div className="landing-cta">
            <a href={authAPI.getGoogleAuthUrl()} className="landing-cta-btn">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Googleアカウントで無料で始める
            </a>
          </div>
          <p className="landing-hint">登録は30秒で完了。クレジットカード不要。</p>
        </div>
        <div className="landing-hero-visual">
          <div className="landing-mockup">
            <div className="mockup-header">
              <span className="mockup-dot"></span>
              <span className="mockup-dot"></span>
              <span className="mockup-dot"></span>
            </div>
            <div className="mockup-content">
              <div className="mockup-card">
                <div className="mockup-badge positive">ハイライト</div>
                <div className="mockup-text">売上高が前年同期比+15.2%増</div>
              </div>
              <div className="mockup-card">
                <div className="mockup-badge positive">ハイライト</div>
                <div className="mockup-text">営業利益率が2.3pt改善</div>
              </div>
              <div className="mockup-card">
                <div className="mockup-badge negative">ローライト</div>
                <div className="mockup-text">海外事業の成長鈍化リスク</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="landing-section landing-problem">
        <div className="landing-container">
          <h2 className="landing-section-title">決算分析、こんな課題はありませんか？</h2>
          <div className="problem-grid">
            <div className="problem-item">
              <span className="problem-icon">⏰</span>
              <h3>時間がかかる</h3>
              <p>決算短信やIR資料を読み込んで分析するのに数時間かかる</p>
            </div>
            <div className="problem-item">
              <span className="problem-icon">📅</span>
              <h3>見逃してしまう</h3>
              <p>多くの銘柄をウォッチしていると、決算発表を見逃すことがある</p>
            </div>
            <div className="problem-item">
              <span className="problem-icon">📊</span>
              <h3>ポイントがわからない</h3>
              <p>数値は見れても、本当に重要なポイントを見落としてしまう</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="landing-section landing-features">
        <div className="landing-container">
          <h2 className="landing-section-title">Kessan Scopeが解決します</h2>
          <div className="features-grid">
            <div className="feature-item">
              <div className="feature-icon">📋</div>
              <h3>ウォッチリスト管理</h3>
              <p>気になる銘柄を登録するだけ。銘柄コードや会社名で簡単に検索・追加できます。</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">🔔</div>
              <h3>決算発表の自動検知</h3>
              <p>TDnetと連携し、登録銘柄の決算発表を自動で検知。見逃しを防ぎます。</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">🤖</div>
              <h3>AIによる自動分析</h3>
              <p>Claude AIが決算短信・説明資料を分析。ハイライト・ローライトを抽出します。</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">💬</div>
              <h3>AIチャットで深掘り</h3>
              <p>分析結果について質問できるチャット機能。疑問点をすぐに解消できます。</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">📧</div>
              <h3>メール通知</h3>
              <p>分析完了時にメールでお知らせ。忙しい時でも重要な情報を逃しません。</p>
            </div>
            <div className="feature-item">
              <div className="feature-icon">📈</div>
              <h3>カスタム分析軸</h3>
              <p>銘柄ごとに独自の分析プロンプトを設定。あなたの視点で分析できます。</p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works Section */}
      <section className="landing-section landing-howto">
        <div className="landing-container">
          <h2 className="landing-section-title">使い方はシンプル</h2>
          <div className="howto-steps">
            <div className="howto-step">
              <div className="howto-number">1</div>
              <h3>銘柄を登録</h3>
              <p>ウォッチしたい銘柄をウォッチリストに追加します</p>
            </div>
            <div className="howto-arrow">→</div>
            <div className="howto-step">
              <div className="howto-number">2</div>
              <h3>自動で分析</h3>
              <p>決算発表を検知すると、AIが自動で分析を開始します</p>
            </div>
            <div className="howto-arrow">→</div>
            <div className="howto-step">
              <div className="howto-number">3</div>
              <h3>結果を確認</h3>
              <p>ハイライト・ローライトを確認し、チャットで深掘りできます</p>
            </div>
          </div>
        </div>
      </section>

      {/* Target Users Section */}
      <section className="landing-section landing-users">
        <div className="landing-container">
          <h2 className="landing-section-title">こんな方におすすめ</h2>
          <div className="users-grid">
            <div className="user-item">
              <div className="user-icon">👔</div>
              <h3>経営者・事業責任者</h3>
              <p>競合や取引先の動向を効率的に把握したい方</p>
            </div>
            <div className="user-item">
              <div className="user-icon">📊</div>
              <h3>投資家</h3>
              <p>複数銘柄の決算を漏れなくチェックしたい方</p>
            </div>
            <div className="user-item">
              <div className="user-icon">🔍</div>
              <h3>アナリスト</h3>
              <p>分析の初期段階を効率化したい方</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="landing-section landing-final-cta">
        <div className="landing-container">
          <h2 className="landing-section-title">今すぐ始めましょう</h2>
          <p className="landing-cta-description">
            Googleアカウントで簡単に登録できます。
            <br />
            まずはウォッチリストに銘柄を追加してみてください。
          </p>
          <a href={authAPI.getGoogleAuthUrl()} className="landing-cta-btn large">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Googleアカウントで無料で始める
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-container">
          <div className="footer-content">
            <div className="footer-brand">
              <span className="footer-logo">📊</span>
              <span className="footer-name">Kessan Scope</span>
            </div>
            <p className="footer-tagline">経営者・事業責任者のための上場企業決算分析ツール</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
