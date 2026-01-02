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

  // URLからタブ状態と選択中のプロンプトを読み取り
  const searchParams = new URLSearchParams(location.search);
  const activeTab: AnalysisTab = searchParams.get('tab') === 'custom' ? 'custom' : 'standard';
  const selectedPromptFromUrl = searchParams.get('prompt');

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

  // 選択中のプロンプトと分析を計算（早期リターンの前にフックを配置）
  const availablePrompts = data?.availablePrompts ?? [];
  const analysesByPrompt = data?.analysesByPrompt ?? [];

  // 選択中のプロンプト（URLにあればそれ、なければ最初のプロンプト）
  const selectedPrompt = useMemo(() => {
    if (selectedPromptFromUrl && availablePrompts.includes(selectedPromptFromUrl)) {
      return selectedPromptFromUrl;
    }
    return availablePrompts[0] || null;
  }, [selectedPromptFromUrl, availablePrompts]);

  // 選択中のプロンプトに対する分析
  const currentAnalysisRaw = useMemo(() => {
    if (!selectedPrompt) return null;
    const found = analysesByPrompt.find(a => a.prompt === selectedPrompt);
    return found?.analysis ?? null;
  }, [selectedPrompt, analysesByPrompt]);

  const currentAnalysis = useMemo(() => parseCustomAnalysis(currentAnalysisRaw), [currentAnalysisRaw]);
  const hasCustomAnalysis = availablePrompts.length > 0;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    sendMutation.mutate(message);
  };

  // URLを更新するヘルパー
  const updateUrl = (tab: AnalysisTab, prompt: string | null) => {
    const params = new URLSearchParams();
    if (tab === 'custom') {
      params.set('tab', 'custom');
      if (prompt) {
        params.set('prompt', prompt);
      }
    }
    const queryString = params.toString();
    navigate(`${location.pathname}${queryString ? `?${queryString}` : ''}`, { replace: true });
  };

  // タブ変更
  const handleTabChange = (tab: AnalysisTab) => {
    updateUrl(tab, selectedPrompt);
  };

  // プロンプト変更
  const handlePromptChange = (prompt: string) => {
    updateUrl('custom', prompt);
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

  const { earnings, notifiedAt, prevEarnings, nextEarnings } = data;
  const messages = chatData?.messages || [];
  const pdfUrl = earnings.r2_key ? earningsAPI.getPdfUrl(id!) : null;

  // 前後ナビゲーションのURL（タブ状態とプロンプトを維持）
  const buildNavUrl = (earningsId: string) => {
    const params = new URLSearchParams();
    if (activeTab === 'custom') {
      params.set('tab', 'custom');
      if (selectedPrompt) {
        params.set('prompt', selectedPrompt);
      }
    }
    const queryString = params.toString();
    return `/earnings/${earningsId}${queryString ? `?${queryString}` : ''}`;
  };

  const prevUrl = prevEarnings ? buildNavUrl(prevEarnings.id) : null;
  const nextUrl = nextEarnings ? buildNavUrl(nextEarnings.id) : null;

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
          {activeTab === 'custom' && (
            <div className="tab-content">
              {/* 分析軸セレクター */}
              {availablePrompts.length > 0 && (
                <div className="prompt-selector">
                  <span className="prompt-selector-label">分析軸:</span>
                  <div className="prompt-buttons">
                    {availablePrompts.map((prompt) => (
                      <button
                        key={prompt}
                        className={`prompt-button ${selectedPrompt === prompt ? 'active' : ''}`}
                        onClick={() => handlePromptChange(prompt)}
                        title={prompt}
                      >
                        {prompt.length > 20 ? `${prompt.substring(0, 20)}...` : prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 時系列ナビゲーション */}
              <nav className="timeline-nav">
                {prevUrl ? (
                  <Link to={prevUrl} className="timeline-link">
                    ◀ {prevEarnings!.fiscal_year}Q{prevEarnings!.fiscal_quarter}
                  </Link>
                ) : (
                  <span className="timeline-link disabled">◀ 前期</span>
                )}
                <span className="timeline-current">
                  {earnings.fiscal_year}Q{earnings.fiscal_quarter}
                </span>
                {nextUrl ? (
                  <Link to={nextUrl} className="timeline-link">
                    {nextEarnings!.fiscal_year}Q{nextEarnings!.fiscal_quarter} ▶
                  </Link>
                ) : (
                  <span className="timeline-link disabled">次期 ▶</span>
                )}
              </nav>

              {/* 分析内容 */}
              {currentAnalysis ? (
                <>
                  {currentAnalysis.overview && (
                    <>
                      <h2>🎯 カスタム観点での概要</h2>
                      <p className="overview">{currentAnalysis.overview}</p>
                    </>
                  )}

                  {(currentAnalysis.highlights.length > 0 || currentAnalysis.lowlights.length > 0) && (
                    <div className="highlights-grid">
                      <div className="highlight-section">
                        <h3>✅ ハイライト</h3>
                        {currentAnalysis.highlights.length > 0 ? (
                          <ul className="highlight-list positive">
                            {currentAnalysis.highlights.map((h, i) => (
                              <li key={i}>{h}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="empty">情報なし</p>
                        )}
                      </div>

                      <div className="highlight-section">
                        <h3>⚠️ ローライト</h3>
                        {currentAnalysis.lowlights.length > 0 ? (
                          <ul className="highlight-list negative">
                            {currentAnalysis.lowlights.map((l, i) => (
                              <li key={i}>{l}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="empty">情報なし</p>
                        )}
                      </div>
                    </div>
                  )}

                  {currentAnalysis.analysis && (
                    <>
                      <h3>📝 詳細分析</h3>
                      <div className="custom-analysis">{currentAnalysis.analysis}</div>
                    </>
                  )}
                </>
              ) : (
                <div className="empty-analysis">
                  <p>この期にはまだ「{selectedPrompt}」での分析がありません</p>
                </div>
              )}
            </div>
          )}
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
