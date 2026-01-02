import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authAPI } from '../api';

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['auth'],
    queryFn: authAPI.getMe,
  });

  const handleLogout = async () => {
    await authAPI.logout();
    queryClient.invalidateQueries({ queryKey: ['auth'] });
  };

  const navItems = [
    { path: '/', label: 'ダッシュボード', icon: '🏠' },
    { path: '/watchlist', label: 'ウォッチリスト', icon: '👁️' },
    { path: '/settings', label: '設定', icon: '⚙️' },
  ];

  return (
    <div className="layout layout-hamburger">
      {/* トップバー */}
      <header className="topbar">
        <button
          className="hamburger-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="メニュー"
        >
          <span className="hamburger-icon">{menuOpen ? '✕' : '☰'}</span>
        </button>
        <Link to="/" className="topbar-logo">
          <span className="logo-icon">📈</span>
          <span className="logo-text">Stock Watcher</span>
        </Link>
      </header>

      {/* スライドメニュー */}
      <div className={`slide-menu ${menuOpen ? 'open' : ''}`}>
        <nav className="slide-menu-nav">
          <ul className="nav-items">
            {navItems.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="slide-menu-footer">
            <div className="menu-user-info">
              <span className="user-email">{data?.user?.email}</span>
            </div>
            <button onClick={handleLogout} className="logout-btn">
              ログアウト
            </button>
          </div>
        </nav>
      </div>

      {/* オーバーレイ */}
      {menuOpen && (
        <div className="menu-overlay" onClick={() => setMenuOpen(false)} />
      )}

      <main className="main-content">{children}</main>
    </div>
  );
}
