import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { earningsAPI, chatAPI, getDocumentTypeLabel } from '../api';
import type { DocumentType } from '../api';

type AnalysisTab = 'standard' | 'custom';

export default function ReleaseDetail() {
  const { releaseId } = useParams<{ releaseId: string }>();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [selectedPdfType, setSelectedPdfType] = useState<DocumentType | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('standard');
  const [selectedPromptIndex, setSelectedPromptIndex] = useState<number>(0);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['release', releaseId],
    queryFn: () => earningsAPI.getReleaseById(releaseId!),
    enabled: !!releaseId,
  });

  const { data: chatData } = useQuery({
    queryKey: ['releaseChat', releaseId],
    queryFn: () => chatAPI.getReleaseMessages(releaseId!),
    enabled: !!releaseId,
  });

  // 最初のドキュメントを選択
  useEffect(() => {
    if (data?.release.documents.length && !selectedPdfType) {
      setSelectedPdfType(data.release.documents[0].document_type);
    }
  }, [data, selectedPdfType]);

  // チャットメッセージが更新されたら自動スクロール
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatData?.messages, streamingContent]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isStreaming) return;

    const userMessage = message;
    setMessage('');
    setIsStreaming(true);
    setStreamingContent('');

    // 楽観的にユーザーメッセージを表示
    const tempUserMessage = {
      id: `temp-${Date.now()}`,
      user_id: '',
      release_id: releaseId!,
      role: 'user' as const,
      content: userMessage,
      created_at: new Date().toISOString(),
    };

    queryClient.setQueryData(['releaseChat', releaseId], (old: { messages: typeof tempUserMessage[] } | undefined) => ({
      messages: [...(old?.messages || []), tempUserMessage],
    }));

    try {
      await chatAPI.sendReleaseMessageStream(releaseId!, userMessage, {
        onUserMessage: () => {},
        onDelta: (content) => {
          setStreamingContent((prev) => prev + content);
        },
        onDone: () => {
          queryClient.invalidateQueries({ queryKey: ['releaseChat', releaseId] });
          setIsStreaming(false);
          setStreamingContent('');
        },
        onError: (error) => {
          console.error('Chat error:', error);
          setIsStreaming(false);
          setStreamingContent('');
          queryClient.invalidateQueries({ queryKey: ['releaseChat', releaseId] });
        },
      });
    } catch (error) {
      console.error('Streaming failed:', error);
      setIsStreaming(false);
      setStreamingContent('');
      queryClient.invalidateQueries({ queryKey: ['releaseChat', releaseId] });
    }
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
        <div className="error">決算発表が見つかりません</div>
      </div>
    );
  }

  const { release, customAnalysis, analysisHistory, prevRelease, nextRelease } = data;
  const messages = chatData?.messages || [];
  const periodLabel = release.fiscal_quarter
    ? `${release.fiscal_year}年 Q${release.fiscal_quarter}`
    : `${release.fiscal_year}年`;

  // 選択中のPDFのURL
  const selectedPdfUrl = selectedPdfType
    ? earningsAPI.getReleasePdfUrl(releaseId!, selectedPdfType)
    : null;

  // 前後ナビゲーションのURL
  const prevUrl = prevRelease ? `/releases/${prevRelease.id}` : null;
  const nextUrl = nextRelease ? `/releases/${nextRelease.id}` : null;

  return (
    <div className="page earnings-detail">
      <header className="detail-header">
        <div className="breadcrumb">
          <Link to="/">ダッシュボード</Link>
          {' / '}
          <Link to={`/stocks/${release.stock_code}`}>{release.stock_code}</Link>
          {' / '}
          {periodLabel}
        </div>
        <div className="title-with-nav">
          <h1>
            {release.stock_code} {release.stock_name || ''} - {periodLabel}
          </h1>
          <nav className="earnings-nav">
            {prevUrl ? (
              <Link to={prevUrl} className="nav-link nav-prev">
                ← {prevRelease!.fiscal_year}{prevRelease!.fiscal_quarter ? `Q${prevRelease!.fiscal_quarter}` : ''}
              </Link>
            ) : (
              <span className="nav-link nav-prev disabled">← 前</span>
            )}
            {nextUrl ? (
              <Link to={nextUrl} className="nav-link nav-next">
                {nextRelease!.fiscal_year}{nextRelease!.fiscal_quarter ? `Q${nextRelease!.fiscal_quarter}` : ''} →
              </Link>
            ) : (
              <span className="nav-link nav-next disabled">次 →</span>
            )}
          </nav>
        </div>
      </header>

      <div className="detail-content-grid">
        {/* 左カラム：PDF + 分析 */}
        <div className="detail-left-column">
          {/* PDF表示セクション */}
          {release.documents.length > 0 && (
            <section className="section">
              <div className="section-header">
                <h2>決算資料</h2>
                <div className="section-actions">
                  <button
                    onClick={() => setShowPdf(!showPdf)}
                    className="toggle-btn"
                  >
                    {showPdf ? '閉じる' : 'プレビュー'}
                  </button>
                </div>
              </div>

              {/* ドキュメントタブ */}
              <div className="document-tabs">
                {release.documents.map((doc) => (
                  <button
                    key={doc.id}
                    className={`document-tab ${selectedPdfType === doc.document_type ? 'active' : ''}`}
                    onClick={() => setSelectedPdfType(doc.document_type)}
                  >
                    {getDocumentTypeLabel(doc.document_type)}
                  </button>
                ))}
              </div>

              {/* 選択中のドキュメント情報 */}
              {selectedPdfType && (
                <div className="selected-document-info">
                  {release.documents.find(d => d.document_type === selectedPdfType)?.document_title || getDocumentTypeLabel(selectedPdfType)}
                  {selectedPdfUrl && (
                    <a
                      href={selectedPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="download-link"
                    >
                      新しいタブで開く
                    </a>
                  )}
                </div>
              )}

              {showPdf && selectedPdfUrl && (
                <div className="pdf-viewer">
                  <iframe
                    src={selectedPdfUrl}
                    title="決算資料PDF"
                    width="100%"
                    height="800"
                  />
                </div>
              )}
            </section>
          )}

          {/* 分析セクション */}
          {(release.summary || customAnalysis) && (
            <section className="section analysis-section">
              {/* 時系列ナビゲーション */}
              <nav className="timeline-nav">
                {prevUrl ? (
                  <Link to={prevUrl} className="timeline-link">
                    ◀ {prevRelease!.fiscal_year}{prevRelease!.fiscal_quarter ? `Q${prevRelease!.fiscal_quarter}` : ''}
                  </Link>
                ) : (
                  <span className="timeline-link disabled">◀ 前期</span>
                )}
                <span className="timeline-current">{periodLabel}</span>
                {nextUrl ? (
                  <Link to={nextUrl} className="timeline-link">
                    {nextRelease!.fiscal_year}{nextRelease!.fiscal_quarter ? `Q${nextRelease!.fiscal_quarter}` : ''} ▶
                  </Link>
                ) : (
                  <span className="timeline-link disabled">次期 ▶</span>
                )}
              </nav>

              {/* タブヘッダー */}
              <div className="analysis-tabs">
                <button
                  className={`analysis-tab ${analysisTab === 'standard' ? 'active' : ''}`}
                  onClick={() => setAnalysisTab('standard')}
                  disabled={!release.summary}
                >
                  標準分析
                </button>
                <button
                  className={`analysis-tab ${analysisTab === 'custom' ? 'active' : ''}`}
                  onClick={() => setAnalysisTab('custom')}
                  disabled={!customAnalysis}
                >
                  カスタム分析
                </button>
              </div>

              {/* 標準分析タブ */}
              {analysisTab === 'standard' && release.summary && (
                <div className="tab-content">
                  <h2>概要</h2>
                  <p className="overview">{release.summary.overview}</p>

                  <div className="metrics-grid">
                    <div className="metric">
                      <div className="metric-label">売上高</div>
                      <div className="metric-value">{release.summary.keyMetrics.revenue}</div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">営業利益</div>
                      <div className="metric-value">{release.summary.keyMetrics.operatingIncome}</div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">純利益</div>
                      <div className="metric-value">{release.summary.keyMetrics.netIncome}</div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">前年同期比</div>
                      <div className="metric-value">{release.summary.keyMetrics.yoyGrowth}</div>
                    </div>
                  </div>

                  <div className="highlights-grid">
                    <div className="highlight-section">
                      <h3>ハイライト</h3>
                      {release.highlights.length > 0 ? (
                        <ul className="highlight-list positive">
                          {release.highlights.map((h, i) => (
                            <li key={i}>{h}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="empty">情報なし</p>
                      )}
                    </div>

                    <div className="highlight-section">
                      <h3>ローライト</h3>
                      {release.lowlights.length > 0 ? (
                        <ul className="highlight-list negative">
                          {release.lowlights.map((l, i) => (
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
              {analysisTab === 'custom' && (customAnalysis || analysisHistory.length > 0) && (
                <div className="tab-content">
                  {/* 分析軸セレクター */}
                  {analysisHistory.length > 0 && (
                    <div className="prompt-selector">
                      <span className="prompt-selector-label">分析軸:</span>
                      <div className="prompt-buttons">
                        {analysisHistory.map((item, index) => (
                          <button
                            key={index}
                            className={`prompt-button ${selectedPromptIndex === index ? 'active' : ''}`}
                            onClick={() => setSelectedPromptIndex(index)}
                            title={item.prompt}
                          >
                            {item.prompt.length > 20 ? `${item.prompt.substring(0, 20)}...` : item.prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 選択中の分析内容 */}
                  {analysisHistory[selectedPromptIndex] && (
                    <div className="custom-analysis-content">
                      <div className="analysis-meta">
                        <span className="analysis-date">
                          {new Date(analysisHistory[selectedPromptIndex].created_at).toLocaleString('ja-JP')}
                        </span>
                      </div>
                      <div className="custom-analysis">
                        {analysisHistory[selectedPromptIndex].analysis}
                      </div>
                    </div>
                  )}

                  {/* analysisHistoryがない場合は customAnalysis を表示 */}
                  {analysisHistory.length === 0 && customAnalysis && (
                    <>
                      {customAnalysis.overview && (
                        <p className="overview">{customAnalysis.overview}</p>
                      )}

                      {(customAnalysis.highlights.length > 0 || customAnalysis.lowlights.length > 0) && (
                        <div className="highlights-grid">
                          <div className="highlight-section">
                            <h3>ハイライト</h3>
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
                            <h3>ローライト</h3>
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
                        <div className="custom-analysis">{customAnalysis.analysis}</div>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        {/* 右カラム：チャット */}
        <div className="detail-right-column">
          <section className="section chat-section">
            <h2>質疑応答</h2>
            <div className="chat-container">
              <div className="chat-messages" ref={chatMessagesRef}>
                {messages.length === 0 && !isStreaming ? (
                  <div className="empty">この決算について質問してみましょう</div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <div key={msg.id} className={`chat-message ${msg.role}`}>
                        <div className="message-role">
                          {msg.role === 'user' ? 'あなた' : 'AI'}
                        </div>
                        <div className="message-content">
                          {msg.role === 'assistant' ? (
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          ) : (
                            msg.content
                          )}
                        </div>
                      </div>
                    ))}
                    {isStreaming && (
                      <div className="chat-message assistant">
                        <div className="message-role">AI</div>
                        <div className="message-content">
                          {streamingContent ? (
                            <ReactMarkdown>{streamingContent}</ReactMarkdown>
                          ) : (
                            <span className="loading-dots">考え中...</span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <form onSubmit={handleSend} className="chat-form">
                <input
                  type="text"
                  placeholder="決算について質問..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={isStreaming}
                />
                <button type="submit" disabled={isStreaming || !message.trim()}>
                  送信
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
