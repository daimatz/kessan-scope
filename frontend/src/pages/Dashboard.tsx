import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { earningsAPI, getDocumentTypeLabel, getReleaseTypeLabel, type DashboardRelease } from '../api';

// 銘柄ごとにグループ化
function groupByStock(releases: DashboardRelease[]): Map<string, DashboardRelease[]> {
  const grouped = new Map<string, DashboardRelease[]>();
  for (const r of releases) {
    const key = r.stock_code;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(r);
  }
  return grouped;
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['releases'],
    queryFn: earningsAPI.getAllReleases,
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

  const releases = data?.releases || [];
  const grouped = groupByStock(releases);

  return (
    <div className="page">
      <h1>ダッシュボード</h1>

      {releases.length === 0 ? (
        <div className="empty-state">
          <p>決算データがありません</p>
          <p>
            <Link to="/watchlist">ウォッチリストに銘柄を追加</Link>
            してください
          </p>
        </div>
      ) : (
        <div className="stock-groups">
          {Array.from(grouped.entries()).map(([stockCode, stockReleases]) => {
            const latestRelease = stockReleases[0];
            const stockName = latestRelease.stock_name || '名称未設定';

            return (
              <section key={stockCode} className="stock-group">
                <div className="stock-group-header">
                  <Link to={`/stocks/${stockCode}`} className="stock-group-title">
                    <span className="stock-code">{stockCode}</span>
                    <span className="stock-name">{stockName}</span>
                  </Link>
                  <span className="stock-count">{stockReleases.length}件</span>
                </div>
                <div className="earnings-list">
                  {stockReleases.slice(0, 3).map((r) => (
                    <Link key={r.id} to={`/releases/${r.id}`} className="earnings-item">
                      <span className="earnings-period">
                        {r.fiscal_year}年{r.fiscal_quarter ? ` Q${r.fiscal_quarter}` : ''}
                      </span>
                      <span className="release-type-badge">
                        {getReleaseTypeLabel(r.release_type)}
                      </span>
                      <span className="document-badges">
                        {r.documents.map((d) => (
                          <span key={d.id} className="doc-badge">
                            {getDocumentTypeLabel(d.document_type).slice(0, 2)}
                          </span>
                        ))}
                      </span>
                      {r.notified_at && <span className="earnings-notified">✅</span>}
                    </Link>
                  ))}
                  {stockReleases.length > 3 && (
                    <Link to={`/stocks/${stockCode}`} className="more-link">
                      他 {stockReleases.length - 3} 件を見る →
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
