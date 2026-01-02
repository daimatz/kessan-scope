import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { earningsAPI, type Earnings } from '../api';

// 銘柄ごとにグループ化
function groupByStock(earnings: Earnings[]): Map<string, Earnings[]> {
  const grouped = new Map<string, Earnings[]>();
  for (const e of earnings) {
    const key = e.stock_code;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(e);
  }
  return grouped;
}

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
  const grouped = groupByStock(earnings);

  return (
    <div className="page">
      <h1>ダッシュボード</h1>

      {earnings.length === 0 ? (
        <div className="empty-state">
          <p>決算データがありません</p>
          <p>
            <Link to="/watchlist">ウォッチリストに銘柄を追加</Link>
            してください
          </p>
        </div>
      ) : (
        <div className="stock-groups">
          {Array.from(grouped.entries()).map(([stockCode, stockEarnings]) => {
            const latestEarnings = stockEarnings[0];
            const stockName = latestEarnings.stock_name || '名称未設定';

            return (
              <section key={stockCode} className="stock-group">
                <div className="stock-group-header">
                  <Link to={`/stocks/${stockCode}`} className="stock-group-title">
                    <span className="stock-code">{stockCode}</span>
                    <span className="stock-name">{stockName}</span>
                  </Link>
                  <span className="stock-count">{stockEarnings.length}件</span>
                </div>
                <div className="earnings-list">
                  {stockEarnings.slice(0, 3).map((e) => (
                    <Link key={e.id} to={`/earnings/${e.id}`} className="earnings-item">
                      <span className="earnings-period">
                        {e.fiscal_year}年 Q{e.fiscal_quarter}
                      </span>
                      <span className="earnings-date">{e.announcement_date}</span>
                      {e.notified_at && <span className="earnings-notified">✅</span>}
                    </Link>
                  ))}
                  {stockEarnings.length > 3 && (
                    <Link to={`/stocks/${stockCode}`} className="more-link">
                      他 {stockEarnings.length - 3} 件を見る →
                    </Link>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
