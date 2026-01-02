import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { earningsAPI, chatAPI, parseCustomAnalysis } from '../api';

const STANDARD_ANALYSIS_KEY = '__standard__';

export default function EarningsDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [showPdf, setShowPdf] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  // URLから選択中の分析軸を読み取り
  const searchParams = new URLSearchParams(location.search);
  const selectedAxisFromUrl = searchParams.get('axis');

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

  // チャットメッセージが更新されたら自動スクロール
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatData?.messages, streamingContent]);

  // 選択中の分析軸を計算（早期リターンの前にフックを配置）
  const customPrompts = data?.availablePrompts ?? [];
  const analysesByPrompt = data?.analysesByPrompt ?? [];
  const hasStandardAnalysis = !!data?.earnings?.summary;
  const hasCustomAnalysis = customPrompts.length > 0;

  // 利用可能なすべての分析軸（標準分析 + カスタムプロンプト）
  const allAxes = useMemo(() => {
    const axes: string[] = [];
    if (hasStandardAnalysis) {
      axes.push(STANDARD_ANALYSIS_KEY);
    }
    axes.push(...customPrompts);
    return axes;
  }, [hasStandardAnalysis, customPrompts]);

  // 選択中の分析軸（URLにあればそれ、なければ最初の軸）
  const selectedAxis = useMemo(() => {
    if (selectedAxisFromUrl && allAxes.includes(selectedAxisFromUrl)) {
      return selectedAxisFromUrl;
    }
    return allAxes[0] || null;
  }, [selectedAxisFromUrl, allAxes]);

  // 選択中の軸がカスタムプロンプトの場合、その分析を取得
  const currentCustomAnalysis = useMemo(() => {
    if (!selectedAxis || selectedAxis === STANDARD_ANALYSIS_KEY) return null;
    const found = analysesByPrompt.find(a => a.prompt === selectedAxis);
    return found ? parseCustomAnalysis(found.analysis) : null;
  }, [selectedAxis, analysesByPrompt]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isStreaming) return;

    const userMessage = message;
    setMessage('');
    setIsStreaming(true);
    setStreamingContent('');

    // 楽観的にユーザーメッセージを表示するため、ローカルに追加
    const tempUserMessage = {
      id: `temp-${Date.now()}`,
      user_id: '',
      earnings_id: id!,
      role: 'user' as const,
      content: userMessage,
      created_at: new Date().toISOString(),
    };

    // 一時的にユーザーメッセージを追加
    queryClient.setQueryData(['chat', id], (old: { messages: typeof tempUserMessage[] } | undefined) => ({
      messages: [...(old?.messages || []), tempUserMessage],
    }));

    try {
      await chatAPI.sendMessageStreamV2(id!, userMessage, {
        onUserMessage: () => {
          // ユーザーメッセージ送信完了
        },
        onDelta: (content) => {
          setStreamingContent((prev) => prev + content);
        },
        onDone: () => {
          // 完了したらチャット履歴を再取得
          queryClient.invalidateQueries({ queryKey: ['chat', id] });
          setIsStreaming(false);
          setStreamingContent('');
        },
        onError: (error) => {
          console.error('Chat error:', error);
          setIsStreaming(false);
          setStreamingContent('');
          // エラー時はチャット履歴を再取得して一時メッセージを消す
          queryClient.invalidateQueries({ queryKey: ['chat', id] });
        },
      });
    } catch (error) {
      console.error('Streaming failed:', error);
      setIsStreaming(false);
      setStreamingContent('');
      queryClient.invalidateQueries({ queryKey: ['chat', id] });
    }
  };

  // 分析軸変更
  const handleAxisChange = (axis: string) => {
    const params = new URLSearchParams();
    // 標準分析以外の場合のみURLにaxisを保存
    if (axis !== STANDARD_ANALYSIS_KEY) {
      params.set('axis', axis);
    }
    const queryString = params.toString();
    navigate(`${location.pathname}${queryString ? `?${queryString}` : ''}`, { replace: true });
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

  // 前後ナビゲーションのURL（分析軸を維持）
  const buildNavUrl = (earningsId: string) => {
    const params = new URLSearchParams();
    if (selectedAxis && selectedAxis !== STANDARD_ANALYSIS_KEY) {
      params.set('axis', selectedAxis);
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

      <div className="detail-content-grid">
        {/* 左カラム：PDF + 分析 */}
        <div className="detail-left-column">
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

          {/* 分析セクション */}
          {(hasStandardAnalysis || hasCustomAnalysis) && (
            <section className="section analysis-section">
              {/* 分析軸セレクター */}
              {allAxes.length > 0 && (
                <div className="prompt-selector">
                  <span className="prompt-selector-label">分析軸:</span>
                  <div className="prompt-buttons">
                    {allAxes.map((axis) => (
                      <button
                        key={axis}
                        className={`prompt-button ${selectedAxis === axis ? 'active' : ''}`}
                        onClick={() => handleAxisChange(axis)}
                        title={axis === STANDARD_ANALYSIS_KEY ? '標準分析' : axis}
                      >
                        {axis === STANDARD_ANALYSIS_KEY
                          ? '📊 標準分析'
                          : axis.length > 20 ? `🎯 ${axis.substring(0, 18)}...` : `🎯 ${axis}`}
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

              {/* 標準分析コンテンツ */}
              {selectedAxis === STANDARD_ANALYSIS_KEY && earnings.summary && (
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

              {/* カスタム分析コンテンツ */}
              {selectedAxis && selectedAxis !== STANDARD_ANALYSIS_KEY && (
                <div className="tab-content">
                  {currentCustomAnalysis ? (
                    <>
                      {currentCustomAnalysis.overview && (
                        <>
                          <h2>🎯 カスタム観点での概要</h2>
                          <p className="overview">{currentCustomAnalysis.overview}</p>
                        </>
                      )}

                      {(currentCustomAnalysis.highlights.length > 0 || currentCustomAnalysis.lowlights.length > 0) && (
                        <div className="highlights-grid">
                          <div className="highlight-section">
                            <h3>✅ ハイライト</h3>
                            {currentCustomAnalysis.highlights.length > 0 ? (
                              <ul className="highlight-list positive">
                                {currentCustomAnalysis.highlights.map((h, i) => (
                                  <li key={i}>{h}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="empty">情報なし</p>
                            )}
                          </div>

                          <div className="highlight-section">
                            <h3>⚠️ ローライト</h3>
                            {currentCustomAnalysis.lowlights.length > 0 ? (
                              <ul className="highlight-list negative">
                                {currentCustomAnalysis.lowlights.map((l, i) => (
                                  <li key={i}>{l}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="empty">情報なし</p>
                            )}
                          </div>
                        </div>
                      )}

                      {currentCustomAnalysis.analysis && (
                        <>
                          <h3>📝 詳細分析</h3>
                          <div className="custom-analysis">{currentCustomAnalysis.analysis}</div>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="empty-analysis">
                      <p>この期にはまだ「{selectedAxis}」での分析がありません</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        {/* 右カラム：チャット */}
        <div className="detail-right-column">
          <section className="section chat-section">
            <h2>💬 質疑応答</h2>
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
