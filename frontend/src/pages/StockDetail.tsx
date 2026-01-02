import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { earningsAPI, watchlistAPI, getDocumentTypeLabel, getReleaseTypeLabel } from '../api';

export default function StockDetail() {
  const { code } = useParams<{ code: string }>();
  const queryClient = useQueryClient();
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // リリースベースのAPIを使用
  const { data, isLoading, error } = useQuery({
    queryKey: ['stockReleases', code],
    queryFn: () => earningsAPI.getReleasesByStock(code!),
    enabled: !!code,
  });

  const updateMutation = useMutation({
    mutationFn: (newPrompt: string) =>
      watchlistAPI.update(data!.watchlist_id!, { custom_prompt: newPrompt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockReleases', code] });
      setEditingPrompt(false);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () => watchlistAPI.regenerate(data!.watchlist_id!),
    onSuccess: (result) => {
      if (result.message) {
        setMessage(result.message);
        setTimeout(() => setMessage(null), 10000);
      }
    },
  });

  const handleSavePrompt = () => {
    updateMutation.mutate(promptValue);
  };

  const handleStartEdit = () => {
    setPromptValue(data?.custom_prompt || '');
    setEditingPrompt(true);
  };

  if (isLoading) {
    return (
      <div className="page">
        <div className="loading">読み込み中...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <div className="error">銘柄データが見つかりません</div>
      </div>
    );
  }

  const displayName = data.stock_name
    ? `${data.stock_name} (${data.stock_code})`
    : data.stock_code;

  return (
    <div className="page stock-detail">
      <header className="detail-header">
        <div className="breadcrumb">
          <Link to="/">ダッシュボード</Link> / {data.stock_code}
        </div>
        <h1>{displayName}</h1>
      </header>

      {message && (
        <div className="import-notice">
          <span className="import-icon">🔄</span>
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="close-btn">×</button>
        </div>
      )}

      <section className="section">
        <h2>カスタムプロンプト</h2>
        {editingPrompt ? (
          <div className="edit-prompt">
            <textarea
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              rows={4}
              placeholder="例: 海外売上比率の推移に注目して分析してください"
            />
            <div className="edit-buttons">
              <button
                onClick={handleSavePrompt}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => setEditingPrompt(false)}
                className="secondary"
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <div className="prompt-display">
            <div className="prompt-content">
              {data.custom_prompt || '（未設定）'}
            </div>
            <div className="prompt-buttons">
              <button onClick={handleStartEdit} className="edit-btn">
                編集
              </button>
              {data.custom_prompt && data.watchlist_id && (
                <button
                  onClick={() => regenerateMutation.mutate()}
                  className="regenerate-btn"
                  disabled={regenerateMutation.isPending}
                >
                  {regenerateMutation.isPending ? '開始中...' : '再分析'}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="section">
        <h2>決算発表一覧 ({data.releases.length}件)</h2>
        {data.releases.length === 0 ? (
          <div className="empty-state">決算発表がありません</div>
        ) : (
          <div className="earnings-table">
            <div className="earnings-table-header">
              <span className="col-period">期間</span>
              <span className="col-type">種類</span>
              <span className="col-docs">資料</span>
              <span className="col-status">ステータス</span>
            </div>
            {data.releases.map((r) => (
              <Link
                key={r.id}
                to={`/releases/${r.id}`}
                className="earnings-table-row"
              >
                <span className="col-period">
                  {r.fiscal_year}年{r.fiscal_quarter ? ` Q${r.fiscal_quarter}` : ''}
                </span>
                <span className="col-type">
                  {getReleaseTypeLabel(r.release_type)}
                </span>
                <span className="col-docs">
                  {r.documents.map((d) => (
                    <span key={d.id} className="doc-badge">
                      {getDocumentTypeLabel(d.document_type).slice(0, 4)}
                    </span>
                  ))}
                </span>
                <span className="col-status">
                  {r.has_summary && <span className="badge badge-summary">要約</span>}
                  {r.has_custom_analysis && (
                    <span className="badge badge-analysis">分析済</span>
                  )}
                  {r.analysis_history_count > 0 && (
                    <span className="badge badge-history">
                      履歴{r.analysis_history_count}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
