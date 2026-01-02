import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Env, EarningsSummary, DocumentType } from '../types';
import { ChatMessageSchema } from '@stock-watcher/shared';
import {
  getChatMessagesByRelease,
  addChatMessageForRelease,
  getEarningsReleaseById,
  getDocumentsForRelease,
  getPastReleasesForChat,
} from '../db/queries';
import { ClaudeService } from '../services/claude';

const chat = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

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
        // PDFがない場合はエラーメッセージ
        fullContent = '申し訳ございません。PDFが利用できないため、質問にお答えできません。';
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

export default chat;
