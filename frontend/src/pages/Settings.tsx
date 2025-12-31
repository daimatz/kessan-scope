import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authAPI, usersAPI } from '../api';

const AVAILABLE_MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o (推奨)' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (高速・低コスト)' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (最安)' },
  { value: 'o1', label: 'o1 (高度な推論)' },
  { value: 'o1-mini', label: 'o1-mini' },
  { value: 'o1-preview', label: 'o1-preview' },
];

export default function Settings() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['auth'],
    queryFn: authAPI.getMe,
  });

  const [model, setModel] = useState(data?.user?.openai_model || 'gpt-4o');

  const mutation = useMutation({
    mutationFn: usersAPI.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ openai_model: model });
  };

  return (
    <div className="page">
      <h1>設定</h1>

      <section className="section">
        <h2>アカウント情報</h2>
        <div className="info-grid">
          <div className="info-row">
            <span className="info-label">メールアドレス</span>
            <span className="info-value">{data?.user?.email}</span>
          </div>
          <div className="info-row">
            <span className="info-label">名前</span>
            <span className="info-value">{data?.user?.name || '未設定'}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>AIモデル設定</h2>
        <p className="section-description">
          決算分析やチャットに使用するOpenAIモデルを選択してください。
        </p>
        <form onSubmit={handleSave} className="settings-form">
          <div className="form-group">
            <label htmlFor="model">モデル</label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? '保存中...' : '保存'}
          </button>
          {mutation.isSuccess && <div className="success">保存しました</div>}
          {mutation.isError && (
            <div className="error">{(mutation.error as Error).message}</div>
          )}
        </form>
      </section>

      <section className="section">
        <h2>モデルの説明</h2>
        <div className="model-descriptions">
          <div className="model-desc">
            <strong>GPT-4o</strong>
            <p>最新のマルチモーダルモデル。高精度かつ高速。決算分析に最適。</p>
          </div>
          <div className="model-desc">
            <strong>GPT-4o Mini</strong>
            <p>軽量版。コストを抑えたい場合に。</p>
          </div>
          <div className="model-desc">
            <strong>o1シリーズ</strong>
            <p>高度な推論が必要な場合に。処理時間が長め。</p>
          </div>
        </div>
      </section>
    </div>
  );
}
