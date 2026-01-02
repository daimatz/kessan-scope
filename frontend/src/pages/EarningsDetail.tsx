import { useState, useMemo } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { earningsAPI, chatAPI, parseCustomAnalysis } from '../api';

type AnalysisTab = 'standard' | 'custom';

export default function EarningsDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [showPdf, setShowPdf] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  // URLからタブ状態を読み取り
  const searchParams = new URLSearchParams(location.search);
  const activeTab: AnalysisTab = searchParams.get('tab') === 'custom' ? 'custom' : 'standard';

  // タブ変更時にURLを更新
  const handleTabChange = (tab: AnalysisTab) => {
    if (tab === 'custom') {
      navigate(`${location.pathname}?tab=custom`, { replace: true });
    } else {
      navigate(location.pathname, { replace: true });
    }
  };

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

  // カスタム分析をパース（早期リターンの前にフックを配置）
  const userAnalysis = data?.userAnalysis ?? null;
  const customAnalysis = useMemo(() => parseCustomAnalysis(userAnalysis), [userAnalysis]);

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

  const { earnings, userPromptUsed, notifiedAt, analysisHistory, prevEarnings, nextEarnings } = data;
  const messages = chatData?.messages || [];
  const pdfUrl = earnings.r2_key ? earningsAPI.getPdfUrl(id!) : null;
  const hasCustomAnalysis = customAnalysis !== null && (customAnalysis.overview || customAnalysis.analysis);

  // 前後ナビゲーションのURL（タブ状態を維持）
  const tabQuery = activeTab === 'custom' ? '?tab=custom' : '';
  const prevUrl = prevEarnings ? `/earnings/${prevEarnings.id}${tabQuery}` : null;
  const nextUrl = nextEarnings ? `/earnings/${nextEarnings.id}${tabQuery}` : null;

  return (
    <div className="page earnings-detail">
      <header className="detail-header">
        <div className="breadcrumb">
          <Link to="/">ダッシュボード</Link>
          {' / '}
          <Link to={`/stocks/${earnings.stock_code}`}>{earnings.stock_code}</Link>
          {' / '}
          {earnings.fiscal_year}Q{earnings.fiscal_quarter}
        </div>
        <div className="title-with-nav">
          <h1>
            {earnings.stock_code} - {earnings.fiscal_year}年 Q{earnings.fiscal_quarter}
          </h1>
          <nav className="earnings-nav">
            {prevUrl ? (
              <Link to={prevUrl} className="nav-link nav-prev">
                ← {prevEarnings!.fiscal_year}Q{prevEarnings!.fiscal_quarter}
              </Link>
            ) : (
              <span className="nav-link nav-prev disabled">← 前</span>
            )}
            {nextUrl ? (
              <Link to={nextUrl} className="nav-link nav-next">
                {nextEarnings!.fiscal_year}Q{nextEarnings!.fiscal_quarter} →
              </Link>
            ) : (
              <span className="nav-link nav-next disabled">次 →</span>
            )}
          </nav>
        </div>
        <div className="meta">
          <span>発表日: {earnings.announcement_date}</span>
          {earnings.document_title && (
            <span className="doc-title">{earnings.document_title}</span>
          )}
          {notifiedAt && <span className="notified">✅ 通知済み</span>}
        </div>
      </header>

      {/* PDF表示セクション */}
      {pdfUrl && (
        <section className="section">
          <div className="section-header">
            <h2>📄 決算資料PDF</h2>
            <div className="section-actions">
              <button
                onClick={() => setShowPdf(!showPdf)}
                className="toggle-btn"
              >
                {showPdf ? '閉じる' : 'プレビュー'}
              </button>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="download-link"
              >
                新しいタブで開く ↗
              </a>
            </div>
          </div>
          {showPdf && (
            <div className="pdf-viewer">
              <iframe
                src={pdfUrl}
                title="決算資料PDF"
                width="100%"
                height="800"
              />
            </div>
          )}
        </section>
      )}

      {/* 分析タブ */}
      {(earnings.summary || hasCustomAnalysis) && (
        <section className="section analysis-section">
          {/* タブヘッダー */}
          <div className="analysis-tabs">
            <button
              className={`analysis-tab ${activeTab === 'standard' ? 'active' : ''}`}
              onClick={() => handleTabChange('standard')}
              disabled={!earnings.summary}
            >
              📊 標準分析
            </button>
            <button
              className={`analysis-tab ${activeTab === 'custom' ? 'active' : ''}`}
              onClick={() => handleTabChange('custom')}
              disabled={!hasCustomAnalysis}
            >
              🎯 カスタム分析
            </button>
          </div>

          {/* 標準分析タブ */}
          {activeTab === 'standard' && earnings.summary && (
            <div className="tab-content">
              <h2>📊 概要</h2>
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

              <div className="highlights-grid">
                <div className="highlight-section">
                  <h3>✅ ハイライト</h3>
                  {earnings.highlights.length > 0 ? (
                    <ul className="highlight-list positive">
                      {earnings.highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty">情報なし</p>
                  )}
                </div>

                <div className="highlight-section">
                  <h3>⚠️ ローライト</h3>
                  {earnings.lowlights.length > 0 ? (
                    <ul className="highlight-list negative">
                      {earnings.lowlights.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty">情報なし</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* カスタム分析タブ */}
          {activeTab === 'custom' && customAnalysis && (
            <div className="tab-content">
              {userPromptUsed && (
                <div className="prompt-used">
                  <span className="prompt-label">分析観点:</span>
                  <span className="prompt-text">{userPromptUsed}</span>
                </div>
              )}

              {customAnalysis.overview && (
                <>
                  <h2>🎯 カスタム観点での概要</h2>
                  <p className="overview">{customAnalysis.overview}</p>
                </>
              )}

              {(customAnalysis.highlights.length > 0 || customAnalysis.lowlights.length > 0) && (
                <div className="highlights-grid">
                  <div className="highlight-section">
                    <h3>✅ ハイライト</h3>
                    {customAnalysis.highlights.length > 0 ? (
                      <ul className="highlight-list positive">
                        {customAnalysis.highlights.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty">情報なし</p>
                    )}
                  </div>

                  <div className="highlight-section">
                    <h3>⚠️ ローライト</h3>
                    {customAnalysis.lowlights.length > 0 ? (
                      <ul className="highlight-list negative">
                        {customAnalysis.lowlights.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty">情報なし</p>
                    )}
                  </div>
                </div>
              )}

              {customAnalysis.analysis && (
                <>
                  <h3>📝 詳細分析</h3>
                  <div className="custom-analysis">{customAnalysis.analysis}</div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* 分析履歴 */}
      {analysisHistory.length > 0 && (
        <section className="section">
          <h2>📜 分析履歴 ({analysisHistory.length}件)</h2>
          <div className="analysis-history">
            {analysisHistory.map((item) => {
              const parsedHistory = parseCustomAnalysis(item.analysis);
              return (
                <div key={item.id} className="history-item">
                  <div
                    className="history-header"
                    onClick={() =>
                      setExpandedHistory(expandedHistory === item.id ? null : item.id)
                    }
                  >
                    <div className="history-prompt">{item.custom_prompt}</div>
                    <div className="history-meta">
                      <span className="history-date">
                        {new Date(item.created_at).toLocaleString('ja-JP')}
                      </span>
                      <span className="history-toggle">
                        {expandedHistory === item.id ? '▼' : '▶'}
                      </span>
                    </div>
                  </div>
                  {expandedHistory === item.id && parsedHistory && (
                    <div className="history-content">
                      {parsedHistory.overview && (
                        <p className="history-overview">{parsedHistory.overview}</p>
                      )}
                      {parsedHistory.highlights.length > 0 && (
                        <div className="history-highlights">
                          <strong>ハイライト:</strong>
                          <ul>
                            {parsedHistory.highlights.map((h, i) => (
                              <li key={i}>{h}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {parsedHistory.lowlights.length > 0 && (
                        <div className="history-lowlights">
                          <strong>ローライト:</strong>
                          <ul>
                            {parsedHistory.lowlights.map((l, i) => (
                              <li key={i}>{l}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {parsedHistory.analysis && (
                        <div className="history-analysis">{parsedHistory.analysis}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* チャット */}
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
