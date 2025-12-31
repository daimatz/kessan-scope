import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authAPI } from '../api';

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const queryClient = useQueryClient();
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
    <div className="layout">
      <nav className="sidebar">
        <div className="logo">
          <span className="logo-icon">📈</span>
          <span className="logo-text">Stock Watcher</span>
        </div>
        <ul className="nav-items">
          {navItems.map((item) => (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="user-info">
          <div className="user-email">{data?.user?.email}</div>
          <button onClick={handleLogout} className="logout-btn">
            ログアウト
          </button>
        </div>
      </nav>
      <main className="main-content">{children}</main>
    </div>
  );
}
