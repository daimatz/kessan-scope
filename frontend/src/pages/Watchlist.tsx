import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { watchlistAPI, stocksAPI, type Stock } from '../api';

export default function Watchlist() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Stock[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 1) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const result = await stocksAPI.search(searchQuery);
        setSearchResults(result.stocks);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['watchlist'],
    queryFn: watchlistAPI.getAll,
  });

  const addMutation = useMutation({
    mutationFn: watchlistAPI.add,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      setSearchQuery('');
      setSelectedStock(null);
      setCustomPrompt('');
      setSearchResults([]);
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
    if (!selectedStock) {
      alert('銘柄を選択してください');
      return;
    }
    addMutation.mutate({
      stock_code: selectedStock.code,
      stock_name: selectedStock.name,
      custom_prompt: customPrompt || undefined,
    });
  };

  const handleSelectStock = (stock: Stock) => {
    setSelectedStock(stock);
    setSearchQuery(`${stock.code} ${stock.name}`);
    setShowDropdown(false);
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
          <div className="stock-search" ref={dropdownRef}>
            <input
              type="text"
              placeholder="証券コードまたは銘柄名で検索"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedStock(null);
              }}
              className="input-search"
            />
            {isSearching && <div className="search-loading">検索中...</div>}
            {showDropdown && searchResults.length > 0 && (
              <div className="search-dropdown">
                {searchResults.map((stock) => (
                  <div
                    key={stock.code}
                    className="search-item"
                    onClick={() => handleSelectStock(stock)}
                  >
                    <span className="search-code">{stock.code}</span>
                    <span className="search-name">{stock.name}</span>
                    {stock.market && <span className="search-market">{stock.market}</span>}
                  </div>
                ))}
              </div>
            )}
            {showDropdown && searchResults.length === 0 && !isSearching && searchQuery.length >= 1 && (
              <div className="search-dropdown">
                <div className="search-empty">該当する銘柄がありません</div>
              </div>
            )}
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
