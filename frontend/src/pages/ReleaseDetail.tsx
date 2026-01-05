import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { earningsAPI, chatAPI, getDocumentTypeLabel, parseCustomAnalysis } from '../api';

export default function ReleaseDetail() {
  const { releaseId } = useParams<{ releaseId: string }>();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [lastDocumentType, setLastDocumentType] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(true); // デフォルトで表示
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  // 'standard', 'current'（現在のカスタム分析）, または履歴のインデックス番号
  const [selectedAnalysis, setSelectedAnalysis] = useState<'standard' | 'current' | number>('standard');
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);

  // スクロール位置が最下部付近かどうかをチェック
  const checkIfNearBottom = useCallback(() => {
    const container = chatMessagesRef.current;
    if (!container) return;
    const threshold = 50; // 最下部から50px以内なら「最下部」とみなす
    const isNear = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    isNearBottomRef.current = isNear;
  }, []);

  // テキストエリアの高さを自動調整（最大3行）
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // 一度リセットしてから高さを計算
    textarea.style.height = 'auto';
    const lineHeight = 24; // 1行の高さ（CSSと合わせる）
    const maxHeight = lineHeight * 3 + 20; // 3行 + padding
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

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

  // ドキュメントを選択（前のページと同じ種類があればそれを、なければ優先順位で選択）
  useEffect(() => {
    if (!data?.release.documents.length) return;

    const docs = data.release.documents;

    // 現在選択中のドキュメントがこのリリースに存在するかチェック
    const currentDoc = selectedDocumentId
      ? docs.find(d => d.id === selectedDocumentId)
      : null;

    if (currentDoc) {
      // 同じドキュメントIDが存在すればそのまま（同じリリース内での切り替え）
      // ドキュメントタイプを記録
      setLastDocumentType(currentDoc.document_type);
      return;
    }

    // 前のリリースで選択していたドキュメントタイプと同じものを探す（ファイルサイズ最大を選択）
    if (lastDocumentType) {
      const sameTypeDocs = docs.filter(d => d.document_type === lastDocumentType);
      if (sameTypeDocs.length > 0) {
        const largest = sameTypeDocs.reduce((a, b) =>
          (b.file_size ?? 0) > (a.file_size ?? 0) ? b : a
        );
        setSelectedDocumentId(largest.id);
        return;
      }
    }

    // フォールバック: 決算説明資料 > 決算短信 > 最初のドキュメント（各タイプ内で最大サイズ）
    const findLargest = (type: string) => {
      const typeDocs = docs.filter(d => d.document_type === type);
      if (typeDocs.length === 0) return null;
      return typeDocs.reduce((a, b) => (b.file_size ?? 0) > (a.file_size ?? 0) ? b : a);
    };
    const newDoc = findLargest('earnings_presentation')
      || findLargest('earnings_summary')
      || docs[0];
    setSelectedDocumentId(newDoc.id);
    setLastDocumentType(newDoc.document_type);
  }, [data, selectedDocumentId, lastDocumentType]);

  // チャットメッセージが更新されたら自動スクロール（最下部付近にいる場合のみ）
  useEffect(() => {
    if (chatMessagesRef.current && isNearBottomRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatData?.messages, streamingContent]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isStreaming) return;

    const userMessage = message;
    setMessage('');
    // テキストエリアの高さをリセット
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setIsStreaming(true);
    setStreamingContent('');
    // 新しいメッセージ送信時は自動スクロールを有効に
    isNearBottomRef.current = true;

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
        onDone: async () => {
          await queryClient.invalidateQueries({ queryKey: ['releaseChat', releaseId] });
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

  const { release, customAnalysis, customPromptUsed, analysisHistory, prevRelease, nextRelease } = data;
  const messages = chatData?.messages || [];
  const periodLabel = release.fiscal_quarter
    ? `${release.fiscal_year}年 Q${release.fiscal_quarter}`
    : `${release.fiscal_year}年`;

  // ドキュメントをソート：決算説明資料 > 決算短信 > 成長可能性資料 > 中期経営計画、各タイプ内はファイルサイズ降順
  const documentTypePriority: Record<string, number> = {
    'earnings_presentation': 0,
    'earnings_summary': 1,
    'growth_potential': 2,
    'mid_term_plan': 3,
  };
  const sortedDocuments = [...release.documents].sort((a, b) => {
    const priorityA = documentTypePriority[a.document_type] ?? 99;
    const priorityB = documentTypePriority[b.document_type] ?? 99;
    if (priorityA !== priorityB) return priorityA - priorityB;
    // 同じタイプ内ではファイルサイズ降順
    return (b.file_size ?? 0) - (a.file_size ?? 0);
  });

  // 選択中のPDFのURL
  const selectedPdfUrl = selectedDocumentId
    ? earningsAPI.getReleasePdfUrlById(releaseId!, selectedDocumentId)
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
          {sortedDocuments.length > 0 && (
            <section className="section pdf-section">
              {/* コンパクトなヘッダー: タブ + 操作ボタン */}
              <div className="pdf-header">
                <div className="document-tabs">
                  {sortedDocuments.map((doc) => (
                    <button
                      key={doc.id}
                      className={`document-tab ${selectedDocumentId === doc.id ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedDocumentId(doc.id);
                        setLastDocumentType(doc.document_type);
                      }}
                      title={doc.document_title || getDocumentTypeLabel(doc.document_type)}
                    >
                      {doc.document_title
                        ? (doc.document_title.length > 20 ? `${doc.document_title.substring(0, 20)}...` : doc.document_title)
                        : getDocumentTypeLabel(doc.document_type)}
                    </button>
                  ))}
                </div>
                <div className="pdf-actions">
                  {selectedPdfUrl && (
                    <a
                      href={selectedPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pdf-action-link"
                    >
                      別タブ↗
                    </a>
                  )}
                  <button
                    onClick={() => setShowPdf(!showPdf)}
                    className={`toggle-btn ${showPdf ? 'active' : ''}`}
                  >
                    {showPdf ? '閉じる' : '開く'}
                  </button>
                </div>
              </div>

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

              {/* 分析軸セレクター（標準 + 現在のカスタム + 履歴全部） */}
              <div className="prompt-selector">
                <span className="prompt-selector-label">分析軸:</span>
                <div className="prompt-buttons">
                  {release.summary && (
                    <button
                      className={`prompt-button ${selectedAnalysis === 'standard' ? 'active' : ''}`}
                      onClick={() => setSelectedAnalysis('standard')}
                    >
                      標準
                    </button>
                  )}
                  {customAnalysis && customPromptUsed && (
                    <button
                      className={`prompt-button ${selectedAnalysis === 'current' ? 'active' : ''}`}
                      onClick={() => setSelectedAnalysis('current')}
                      title={customPromptUsed}
                    >
                      {customPromptUsed.length > 15 ? `${customPromptUsed.substring(0, 15)}...` : customPromptUsed}
                    </button>
                  )}
                  {analysisHistory.map((item, index) => (
                    <button
                      key={index}
                      className={`prompt-button ${selectedAnalysis === index ? 'active' : ''}`}
                      onClick={() => setSelectedAnalysis(index)}
                      title={item.prompt}
                    >
                      {item.prompt.length > 15 ? `${item.prompt.substring(0, 15)}...` : item.prompt}
                    </button>
                  ))}
                </div>
              </div>

              {/* 標準分析 */}
              {selectedAnalysis === 'standard' && release.summary && (
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

              {/* 現在のカスタム分析 */}
              {selectedAnalysis === 'current' && customAnalysis && (
                <div className="tab-content">
                  <h2>概要</h2>
                  <p className="overview">{customAnalysis.overview}</p>

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

                  {customAnalysis.analysis && (
                    <div className="custom-analysis">
                      <h3>詳細分析</h3>
                      <ReactMarkdown remarkPlugins={[remarkCjkFriendly, remarkGfm]}>{customAnalysis.analysis}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}

              {/* 履歴のカスタム分析 */}
              {typeof selectedAnalysis === 'number' && analysisHistory[selectedAnalysis] && (() => {
                const historyItem = analysisHistory[selectedAnalysis];
                const parsed = parseCustomAnalysis(historyItem.analysis);
                return (
                  <div className="tab-content">
                    <div className="analysis-meta">
                      <span className="analysis-date">
                        {new Date(historyItem.created_at).toLocaleString('ja-JP')}
                      </span>
                    </div>

                    {parsed && (
                      <>
                        <h2>概要</h2>
                        <p className="overview">{parsed.overview}</p>

                        <div className="highlights-grid">
                          <div className="highlight-section">
                            <h3>ハイライト</h3>
                            {parsed.highlights.length > 0 ? (
                              <ul className="highlight-list positive">
                                {parsed.highlights.map((h, i) => (
                                  <li key={i}>{h}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="empty">情報なし</p>
                            )}
                          </div>

                          <div className="highlight-section">
                            <h3>ローライト</h3>
                            {parsed.lowlights.length > 0 ? (
                              <ul className="highlight-list negative">
                                {parsed.lowlights.map((l, i) => (
                                  <li key={i}>{l}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="empty">情報なし</p>
                            )}
                          </div>
                        </div>

                        {parsed.analysis && (
                          <div className="custom-analysis">
                            <h3>詳細分析</h3>
                            <ReactMarkdown remarkPlugins={[remarkCjkFriendly, remarkGfm]}>{parsed.analysis}</ReactMarkdown>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
            </section>
          )}
        </div>

        {/* 右カラム：チャット */}
        <div className="detail-right-column">
          <section className="section chat-section">
            <h2>質疑応答</h2>
            <div className="chat-container">
              <div className="chat-messages" ref={chatMessagesRef} onScroll={checkIfNearBottom}>
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
                            <ReactMarkdown remarkPlugins={[remarkCjkFriendly, remarkGfm]}>{msg.content}</ReactMarkdown>
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
                            <ReactMarkdown remarkPlugins={[remarkCjkFriendly, remarkGfm]}>{streamingContent}</ReactMarkdown>
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
                <textarea
                  ref={textareaRef}
                  placeholder="決算について質問..."
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    adjustTextareaHeight();
                  }}
                  onKeyDown={(e) => {
                    // Ctrl+Enter or Cmd+Enter で送信
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                  disabled={isStreaming}
                  rows={1}
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
