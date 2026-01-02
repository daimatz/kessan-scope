import { Hono } from 'hono';
import type { Env, EarningsSummary } from '../types';
import { getChatMessages, addChatMessage, getEarningsById, getPastEarningsForChat } from '../db/queries';
import { ClaudeService } from '../services/claude';

const chat = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// チャット履歴取得
chat.get('/:earningsId', async (c) => {
  const userId = c.get('userId');
  const earningsId = c.req.param('earningsId');

  const messages = await getChatMessages(c.env.DB, userId, earningsId);

  return c.json({ messages });
});

// チャット送信
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

      // 過去の決算データをパース
      const pastEarnings = pastEarningsRaw.map(e => {
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

      // 過去の決算コンテキストを生成
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

  return c.json({
    userMessage,
    assistantMessage,
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

export default chat;
