import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { watchlistAPI } from '../api';

export default function Watchlist() {
  const queryClient = useQueryClient();
  const [stockCode, setStockCode] = useState('');
  const [stockName, setStockName] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['watchlist'],
    queryFn: watchlistAPI.getAll,
  });

  const addMutation = useMutation({
    mutationFn: watchlistAPI.add,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      setStockCode('');
      setStockName('');
      setCustomPrompt('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: watchlistAPI.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { custom_prompt?: string } }) =>
      watchlistAPI.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      setEditingId(null);
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockCode || !/^\d{4}$/.test(stockCode)) {
      alert('証券コードは4桁の数字で入力してください');
      return;
    }
    addMutation.mutate({
      stock_code: stockCode,
      stock_name: stockName || undefined,
      custom_prompt: customPrompt || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="page">
        <h1>ウォッチリスト</h1>
        <div className="loading">読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h1>ウォッチリスト</h1>
        <div className="error">エラーが発生しました</div>
      </div>
    );
  }

  const items = data?.items || [];

  return (
    <div className="page">
      <h1>ウォッチリスト</h1>

      <section className="section">
        <h2>銘柄を追加</h2>
        <form onSubmit={handleAdd} className="add-form">
          <div className="form-row">
            <input
              type="text"
              placeholder="証券コード（4桁）"
              value={stockCode}
              onChange={(e) => setStockCode(e.target.value)}
              maxLength={4}
              pattern="\d{4}"
              required
              className="input-code"
            />
            <input
              type="text"
              placeholder="銘柄名（任意）"
              value={stockName}
              onChange={(e) => setStockName(e.target.value)}
              className="input-name"
            />
          </div>
          <textarea
            placeholder="カスタム分析プロンプト（任意）&#10;例: 海外売上比率の推移に注目して分析してください"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            className="input-prompt"
            rows={3}
          />
          <button type="submit" disabled={addMutation.isPending}>
            {addMutation.isPending ? '追加中...' : '追加'}
          </button>
          {addMutation.isError && (
            <div className="error">{(addMutation.error as Error).message}</div>
          )}
        </form>
      </section>

      <section className="section">
        <h2>登録済み銘柄 ({items.length})</h2>
        {items.length === 0 ? (
          <div className="empty-state">登録された銘柄はありません</div>
        ) : (
          <div className="watchlist-items">
            {items.map((item) => (
              <div key={item.id} className="watchlist-item">
                <div className="item-header">
                  <span className="stock-code">{item.stock_code}</span>
                  <span className="stock-name">{item.stock_name || '名称未設定'}</span>
                  <button
                    onClick={() => removeMutation.mutate(item.id)}
                    className="delete-btn"
                    disabled={removeMutation.isPending}
                  >
                    削除
                  </button>
                </div>
                {editingId === item.id ? (
                  <div className="edit-prompt">
                    <textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      rows={3}
                    />
                    <div className="edit-buttons">
                      <button
                        onClick={() =>
                          updateMutation.mutate({
                            id: item.id,
                            data: { custom_prompt: editPrompt },
                          })
                        }
                        disabled={updateMutation.isPending}
                      >
                        保存
                      </button>
                      <button onClick={() => setEditingId(null)} className="secondary">
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="item-prompt">
                    <div className="prompt-label">カスタムプロンプト:</div>
                    <div className="prompt-content">
                      {item.custom_prompt || '（未設定）'}
                    </div>
                    <button
                      onClick={() => {
                        setEditingId(item.id);
                        setEditPrompt(item.custom_prompt || '');
                      }}
                      className="edit-btn"
                    >
                      編集
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
