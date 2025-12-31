import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { earningsAPI } from '../api';

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['earnings'],
    queryFn: earningsAPI.getAll,
  });

  if (isLoading) {
    return (
      <div className="page">
        <h1>ダッシュボード</h1>
        <div className="loading">読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h1>ダッシュボード</h1>
        <div className="error">エラーが発生しました</div>
      </div>
    );
  }

  const earnings = data?.earnings || [];

  return (
    <div className="page">
      <h1>ダッシュボード</h1>
      
      <section className="section">
        <h2>最新の決算</h2>
        {earnings.length === 0 ? (
          <div className="empty-state">
            <p>決算データがありません</p>
            <p>
              <Link to="/watchlist">ウォッチリストに銘柄を追加</Link>
              してください
            </p>
          </div>
        ) : (
          <div className="earnings-grid">
            {earnings.map((e) => (
              <Link key={e.id} to={`/earnings/${e.id}`} className="earnings-card">
                <div className="earnings-header">
                  <span className="stock-code">{e.stock_code}</span>
                  <span className="stock-name">{e.stock_name || '名称未設定'}</span>
                </div>
                <div className="earnings-period">
                  {e.fiscal_year}年 Q{e.fiscal_quarter}
                </div>
                <div className="earnings-date">
                  発表日: {e.announcement_date}
                </div>
                {e.notified_at && (
                  <div className="earnings-notified">✅ 通知済み</div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
