import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { earningsAPI, watchlistAPI } from '../api';

export default function StockDetail() {
  const { code } = useParams<{ code: string }>();
  const queryClient = useQueryClient();
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock', code],
    queryFn: () => earningsAPI.getByStock(code!),
    enabled: !!code,
  });

  const updateMutation = useMutation({
    mutationFn: (newPrompt: string) =>
      watchlistAPI.update(data!.watchlist_id!, { custom_prompt: newPrompt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock', code] });
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
        <h2>決算資料一覧 ({data.earnings.length}件)</h2>
        {data.earnings.length === 0 ? (
          <div className="empty-state">決算資料がありません</div>
        ) : (
          <div className="earnings-table">
            <div className="earnings-table-header">
              <span className="col-period">期間</span>
              <span className="col-date">発表日</span>
              <span className="col-title">タイトル</span>
              <span className="col-status">ステータス</span>
            </div>
            {data.earnings.map((e) => (
              <Link
                key={e.id}
                to={`/earnings/${e.id}`}
                className="earnings-table-row"
              >
                <span className="col-period">
                  {e.fiscal_year}年 Q{e.fiscal_quarter}
                </span>
                <span className="col-date">{e.announcement_date}</span>
                <span className="col-title">
                  {e.document_title || '決算資料'}
                </span>
                <span className="col-status">
                  {e.has_pdf && <span className="badge badge-pdf">PDF</span>}
                  {e.has_summary && <span className="badge badge-summary">要約</span>}
                  {e.has_custom_analysis && (
                    <span className="badge badge-analysis">分析済</span>
                  )}
                  {e.analysis_history_count > 0 && (
                    <span className="badge badge-history">
                      履歴{e.analysis_history_count}
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
