import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Env, EarningsSummary, DocumentType } from '../types';
import { ChatMessageSchema } from '@stock-watcher/shared';
import {
  getChatMessages,
  addChatMessage,
  getEarningsById,
  getPastEarningsForChat,
  getChatMessagesByRelease,
  addChatMessageForRelease,
  getEarningsReleaseById,
  getDocumentsForRelease,
  getPastReleasesForChat,
} from '../db/queries';
import { ClaudeService } from '../services/claude';

const chat = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// チャット履歴取得
chat.get('/:earningsId', async (c) => {
  const userId = c.get('userId');
  const earningsId = c.req.param('earningsId');

  const messages = await getChatMessages(c.env.DB, userId, earningsId);

  // zod で API レスポンス用にフィルタリング
  return c.json({ messages: messages.map(m => ChatMessageSchema.parse(m)) });
});

// 過去の決算データをパースするヘルパー
function parsePastEarnings(pastEarningsRaw: Array<{
  fiscal_year: string;
  fiscal_quarter: number;
  summary: string | null;
  highlights: string | null;
  lowlights: string | null;
}>) {
  return pastEarningsRaw.map(e => {
    let summary: EarningsSummary | null = null;
    let highlights: string[] = [];
    let lowlights: string[] = [];

    if (e.summary) {
      try {
        summary = JSON.parse(e.summary);
      } catch {
        // ignore
      }
    }
    if (e.highlights) {
      try {
        highlights = JSON.parse(e.highlights);
      } catch {
        // ignore
      }
    }
    if (e.lowlights) {
      try {
        lowlights = JSON.parse(e.lowlights);
      } catch {
        // ignore
      }
    }

    return {
      fiscal_year: e.fiscal_year,
      fiscal_quarter: e.fiscal_quarter,
      summary,
      highlights,
      lowlights,
    };
  });
}

// チャット送信（ストリーミング）
chat.post('/:earningsId/stream', async (c) => {
  const userId = c.get('userId');
  const earningsId = c.req.param('earningsId');
  const body = await c.req.json<{ message: string }>();

  if (!body.message || body.message.trim().length === 0) {
    return c.json({ error: 'メッセージを入力してください' }, 400);
  }

  // 決算データを取得
  const earnings = await getEarningsById(c.env.DB, earningsId);
  if (!earnings) {
    return c.json({ error: '決算データが見つかりません' }, 404);
  }

  // 既存のチャット履歴を取得
  const existingMessages = await getChatMessages(c.env.DB, userId, earningsId);

  // ユーザーメッセージを保存
  const userMessage = await addChatMessage(c.env.DB, {
    user_id: userId,
    earnings_id: earningsId,
    role: 'user',
    content: body.message,
  });

  return streamSSE(c, async (stream) => {
    const claude = new ClaudeService(c.env.ANTHROPIC_API_KEY);
    let fullContent = '';

    try {
      // ユーザーメッセージIDを送信
      await stream.writeSSE({
        event: 'user_message',
        data: JSON.stringify({ id: userMessage.id }),
      });

      // PDFがある場合は新しいchatWithPdfStreamを使用
      if (earnings.r2_key) {
        const pdfObject = await c.env.PDF_BUCKET.get(earnings.r2_key);
        if (!pdfObject) {
          throw new Error('PDF not found in R2');
        }
        const pdfBuffer = await pdfObject.arrayBuffer();

        // 過去の決算履歴を取得
        const pastEarningsRaw = await getPastEarningsForChat(
          c.env.DB,
          earnings.stock_code,
          earningsId,
          4
        );
        const pastEarnings = parsePastEarnings(pastEarningsRaw);
        const pastEarningsContext = ClaudeService.formatPastEarningsContext(pastEarnings);

        // ストリーミングでチャット
        const generator = claude.chatWithPdfStream(
          pdfBuffer,
          {
            fiscal_year: earnings.fiscal_year,
            fiscal_quarter: earnings.fiscal_quarter,
            stock_code: earnings.stock_code,
          },
          pastEarningsContext,
          existingMessages.map(m => ({ role: m.role, content: m.content })),
          body.message
        );

        for await (const chunk of generator) {
          fullContent += chunk;
          await stream.writeSSE({
            event: 'delta',
            data: JSON.stringify({ content: chunk }),
          });
        }
      } else {
        // PDFがない場合はサマリーベースのチャット（非ストリーミング）
        fullContent = await fallbackToSummaryChat(claude, earnings, existingMessages, body.message);
        await stream.writeSSE({
          event: 'delta',
          data: JSON.stringify({ content: fullContent }),
        });
      }

      // アシスタントメッセージを保存
      const assistantMessage = await addChatMessage(c.env.DB, {
        user_id: userId,
        earnings_id: earningsId,
        role: 'assistant',
        content: fullContent,
      });

      // 完了通知
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ id: assistantMessage.id }),
      });
    } catch (error) {
      console.error('Streaming chat failed:', error);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: 'チャットの生成に失敗しました' }),
      });
    }
  });
});

// チャット送信（非ストリーミング、後方互換性のため維持）
chat.post('/:earningsId', async (c) => {
  const userId = c.get('userId');
  const earningsId = c.req.param('earningsId');
  const body = await c.req.json<{ message: string }>();

  if (!body.message || body.message.trim().length === 0) {
    return c.json({ error: 'メッセージを入力してください' }, 400);
  }

  // 決算データを取得
  const earnings = await getEarningsById(c.env.DB, earningsId);
  if (!earnings) {
    return c.json({ error: '決算データが見つかりません' }, 404);
  }

  // 既存のチャット履歴を取得
  const existingMessages = await getChatMessages(c.env.DB, userId, earningsId);

  // ユーザーメッセージを保存
  const userMessage = await addChatMessage(c.env.DB, {
    user_id: userId,
    earnings_id: earningsId,
    role: 'user',
    content: body.message,
  });

  const claude = new ClaudeService(c.env.ANTHROPIC_API_KEY);
  let assistantContent: string;

  // PDFがある場合は新しいchatWithPdfを使用
  if (earnings.r2_key) {
    try {
      // R2からPDFを取得
      const pdfObject = await c.env.PDF_BUCKET.get(earnings.r2_key);
      if (!pdfObject) {
        throw new Error('PDF not found in R2');
      }
      const pdfBuffer = await pdfObject.arrayBuffer();

      // 過去の決算履歴を取得（直近4期分）
      const pastEarningsRaw = await getPastEarningsForChat(
        c.env.DB,
        earnings.stock_code,
        earningsId,
        4
      );
      const pastEarnings = parsePastEarnings(pastEarningsRaw);
      const pastEarningsContext = ClaudeService.formatPastEarningsContext(pastEarnings);

      // PDFベースのチャット
      assistantContent = await claude.chatWithPdf(
        pdfBuffer,
        {
          fiscal_year: earnings.fiscal_year,
          fiscal_quarter: earnings.fiscal_quarter,
          stock_code: earnings.stock_code,
        },
        pastEarningsContext,
        existingMessages.map(m => ({ role: m.role, content: m.content })),
        body.message
      );
    } catch (error) {
      console.error('PDF-based chat failed, falling back to summary-based:', error);
      // フォールバック: サマリーベースのチャット
      assistantContent = await fallbackToSummaryChat(claude, earnings, existingMessages, body.message);
    }
  } else {
    // PDFがない場合はサマリーベースのチャット
    assistantContent = await fallbackToSummaryChat(claude, earnings, existingMessages, body.message);
  }

  // アシスタントメッセージを保存
  const assistantMessage = await addChatMessage(c.env.DB, {
    user_id: userId,
    earnings_id: earningsId,
    role: 'assistant',
    content: assistantContent,
  });

  // zod で API レスポンス用にフィルタリング
  return c.json({
    userMessage: ChatMessageSchema.parse(userMessage),
    assistantMessage: ChatMessageSchema.parse(assistantMessage),
  });
});

// サマリーベースのチャット（フォールバック用）
async function fallbackToSummaryChat(
  claude: ClaudeService,
  earnings: { summary: string | null },
  existingMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string
): Promise<string> {
  let summary: EarningsSummary | null = null;
  if (earnings.summary) {
    try {
      summary = JSON.parse(earnings.summary);
    } catch {
      // ignore
    }
  }

  if (!summary) {
    return '申し訳ございません。決算サマリーが利用できないため、質問にお答えできません。';
  }

  return claude.chat(
    summary,
    existingMessages.map(m => ({ role: m.role, content: m.content })),
    userMessage
  );
}

// ============================================
// EarningsRelease チャットルート（新規）
// ============================================

// 過去のリリースデータをパースするヘルパー
function parsePastReleases(pastReleasesRaw: Array<{
  fiscal_year: string;
  fiscal_quarter: number | null;
  summary: string | null;
  highlights: string | null;
  lowlights: string | null;
}>) {
  return pastReleasesRaw.map(r => {
    let summary: EarningsSummary | null = null;
    let highlights: string[] = [];
    let lowlights: string[] = [];

    if (r.summary) {
      try {
        summary = JSON.parse(r.summary);
      } catch {
        // ignore
      }
    }
    if (r.highlights) {
      try {
        highlights = JSON.parse(r.highlights);
      } catch {
        // ignore
      }
    }
    if (r.lowlights) {
      try {
        lowlights = JSON.parse(r.lowlights);
      } catch {
        // ignore
      }
    }

    return {
      fiscal_year: r.fiscal_year,
      fiscal_quarter: r.fiscal_quarter ?? 0,
      summary,
      highlights,
      lowlights,
    };
  });
}

// リリースのチャット履歴取得
chat.get('/release/:releaseId', async (c) => {
  const userId = c.get('userId');
  const releaseId = c.req.param('releaseId');

  const messages = await getChatMessagesByRelease(c.env.DB, userId, releaseId);

  // zod で API レスポンス用にフィルタリング
  return c.json({ messages: messages.map(m => ChatMessageSchema.parse(m)) });
});

// リリースのチャット送信（ストリーミング）
chat.post('/release/:releaseId/stream', async (c) => {
  const userId = c.get('userId');
  const releaseId = c.req.param('releaseId');
  const body = await c.req.json<{ message: string }>();

  if (!body.message || body.message.trim().length === 0) {
    return c.json({ error: 'メッセージを入力してください' }, 400);
  }

  // リリースデータを取得
  const release = await getEarningsReleaseById(c.env.DB, releaseId);
  if (!release) {
    return c.json({ error: '決算発表が見つかりません' }, 404);
  }

  // リリースに紐づくドキュメントを取得
  const documents = await getDocumentsForRelease(c.env.DB, releaseId);

  // 既存のチャット履歴を取得
  const existingMessages = await getChatMessagesByRelease(c.env.DB, userId, releaseId);

  // ユーザーメッセージを保存
  const userMessage = await addChatMessageForRelease(c.env.DB, {
    user_id: userId,
    release_id: releaseId,
    role: 'user',
    content: body.message,
  });

  return streamSSE(c, async (stream) => {
    const claude = new ClaudeService(c.env.ANTHROPIC_API_KEY);
    let fullContent = '';

    try {
      // ユーザーメッセージIDを送信
      await stream.writeSSE({
        event: 'user_message',
        data: JSON.stringify({ id: userMessage.id }),
      });

      // 各ドキュメントのPDFを取得
      const pdfDocuments: Array<{ buffer: ArrayBuffer; type: DocumentType }> = [];
      for (const doc of documents) {
        if (!doc.r2_key || !doc.document_type) continue;

        const pdfObject = await c.env.PDF_BUCKET.get(doc.r2_key);
        if (pdfObject) {
          pdfDocuments.push({
            buffer: await pdfObject.arrayBuffer(),
            type: doc.document_type,
          });
        }
      }

      if (pdfDocuments.length > 0) {
        // 過去のリリース履歴を取得
        const pastReleasesRaw = await getPastReleasesForChat(
          c.env.DB,
          release.stock_code,
          releaseId,
          4
        );
        const pastReleases = parsePastReleases(pastReleasesRaw);
        const pastEarningsContext = ClaudeService.formatPastEarningsContext(pastReleases);

        // ストリーミングでチャット（複数PDF対応）
        const generator = claude.chatWithPdfsStream(
          pdfDocuments,
          {
            fiscal_year: release.fiscal_year,
            fiscal_quarter: release.fiscal_quarter,
            stock_code: release.stock_code,
          },
          pastEarningsContext,
          existingMessages.map(m => ({ role: m.role, content: m.content })),
          body.message
        );

        for await (const chunk of generator) {
          fullContent += chunk;
          await stream.writeSSE({
            event: 'delta',
            data: JSON.stringify({ content: chunk }),
          });
        }
      } else {
        // PDFがない場合はサマリーベースのチャット
        fullContent = await fallbackToReleaseSummaryChat(release, existingMessages, body.message);
        await stream.writeSSE({
          event: 'delta',
          data: JSON.stringify({ content: fullContent }),
        });
      }

      // アシスタントメッセージを保存
      const assistantMessage = await addChatMessageForRelease(c.env.DB, {
        user_id: userId,
        release_id: releaseId,
        role: 'assistant',
        content: fullContent,
      });

      // 完了通知
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ id: assistantMessage.id }),
      });
    } catch (error) {
      console.error('Streaming chat failed:', error);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: 'チャットの生成に失敗しました' }),
      });
    }
  });
});

// リリースのサマリーベースチャット（フォールバック用）
function fallbackToReleaseSummaryChat(
  release: { summary: string | null },
  existingMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string
): string {
  if (!release.summary) {
    return '申し訳ございません。決算サマリーが利用できないため、質問にお答えできません。';
  }

  // 簡易的なフォールバック応答
  return '申し訳ございません。PDFが利用できないため、詳細な質問にお答えできません。サマリーを確認してください。';
}

export default chat;
