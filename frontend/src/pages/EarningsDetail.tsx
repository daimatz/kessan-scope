import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { earningsAPI, chatAPI } from '../api';

export default function EarningsDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['earnings', id],
    queryFn: () => earningsAPI.getById(id!),
    enabled: !!id,
  });

  const { data: chatData } = useQuery({
    queryKey: ['chat', id],
    queryFn: () => chatAPI.getMessages(id!),
    enabled: !!id,
  });

  const sendMutation = useMutation({
    mutationFn: (msg: string) => chatAPI.sendMessage(id!, msg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', id] });
      setMessage('');
    },
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    sendMutation.mutate(message);
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
        <div className="error">決算データが見つかりません</div>
      </div>
    );
  }

  const { earnings, userAnalysis, notifiedAt } = data;
  const messages = chatData?.messages || [];

  return (
    <div className="page earnings-detail">
      <header className="detail-header">
        <h1>
          {earnings.stock_code} - {earnings.fiscal_year}年 Q{earnings.fiscal_quarter}
        </h1>
        <div className="meta">
          <span>発表日: {earnings.announcement_date}</span>
          {notifiedAt && <span className="notified">✅ 通知済み</span>}
        </div>
      </header>

      {earnings.summary && (
        <section className="section">
          <h2>概要</h2>
          <p className="overview">{earnings.summary.overview}</p>

          <div className="metrics-grid">
            <div className="metric">
              <div className="metric-label">売上高</div>
              <div className="metric-value">{earnings.summary.keyMetrics.revenue}</div>
            </div>
            <div className="metric">
              <div className="metric-label">営業利益</div>
              <div className="metric-value">{earnings.summary.keyMetrics.operatingIncome}</div>
            </div>
            <div className="metric">
              <div className="metric-label">純利益</div>
              <div className="metric-value">{earnings.summary.keyMetrics.netIncome}</div>
            </div>
            <div className="metric">
              <div className="metric-label">前年同期比</div>
              <div className="metric-value">{earnings.summary.keyMetrics.yoyGrowth}</div>
            </div>
          </div>
        </section>
      )}

      <div className="highlights-grid">
        <section className="section highlight-section">
          <h2>✅ ハイライト</h2>
          {earnings.highlights.length > 0 ? (
            <ul className="highlight-list positive">
              {earnings.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          ) : (
            <p className="empty">情報なし</p>
          )}
        </section>

        <section className="section highlight-section">
          <h2>⚠️ ローライト</h2>
          {earnings.lowlights.length > 0 ? (
            <ul className="highlight-list negative">
              {earnings.lowlights.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="empty">情報なし</p>
          )}
        </section>
      </div>

      {userAnalysis && (
        <section className="section">
          <h2>カスタム分析</h2>
          <div className="custom-analysis">{userAnalysis}</div>
        </section>
      )}

      <section className="section chat-section">
        <h2>💬 質疑応答</h2>
        <div className="chat-container">
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="empty">この決算について質問してみましょう</div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`chat-message ${msg.role}`}>
                  <div className="message-role">
                    {msg.role === 'user' ? 'あなた' : 'AI'}
                  </div>
                  <div className="message-content">{msg.content}</div>
                </div>
              ))
            )}
            {sendMutation.isPending && (
              <div className="chat-message assistant">
                <div className="message-role">AI</div>
                <div className="message-content loading-dots">考え中...</div>
              </div>
            )}
          </div>
          <form onSubmit={handleSend} className="chat-form">
            <input
              type="text"
              placeholder="決算について質問..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={sendMutation.isPending}
            />
            <button type="submit" disabled={sendMutation.isPending || !message.trim()}>
              送信
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
