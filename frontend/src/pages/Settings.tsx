import { useQuery } from '@tanstack/react-query';
import { authAPI } from '../api';

export default function Settings() {
  const { data } = useQuery({
    queryKey: ['auth'],
    queryFn: authAPI.getMe,
  });

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
    </div>
  );
}
