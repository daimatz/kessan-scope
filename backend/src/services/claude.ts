import Anthropic from '@anthropic-ai/sdk';
import type { EarningsSummary, CustomAnalysisSummary } from '../types';

export class ClaudeService {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  // PDFから決算内容を解析（事業家目線で戦略分析）
  async analyzeEarningsPdf(pdfBuffer: ArrayBuffer): Promise<EarningsSummary> {
    const base64Pdf = this.arrayBufferToBase64(pdfBuffer);

    const systemPrompt = `あなたは事業戦略コンサルタントです。決算短信を事業家目線で分析してください。

【分析の視点】
- 単なる数字の良し悪しではなく、経営陣の意思決定の背景を読み解く
- 事業ポートフォリオの変化、投資判断の意図を深掘りする
- セグメント別の戦略的重点や撤退/拡大の兆候を見抜く
- 競合環境の変化に対する経営の対応姿勢を分析する
- 中長期的な事業構造の転換を示唆する動きを捉える

【出力JSON形式】
{
  "overview": "この決算から読み取れる経営の戦略的意図と事業の方向性（300文字程度、数字の羅列ではなく戦略の本質を記述）",
  "highlights": [
    "戦略的に注目すべきポジティブな動き（投資判断、事業再編、競争優位性の強化など）を具体的に（3-5項目）"
  ],
  "lowlights": [
    "戦略上のリスクや経営課題（構造的問題、競合劣位、投資の失敗兆候など）を具体的に（3-5項目）"
  ],
  "keyMetrics": {
    "revenue": "売上高（単位付き）",
    "operatingIncome": "営業利益（単位付き）",
    "netIncome": "純利益（単位付き）",
    "yoyGrowth": "前年同期比成長率"
  }
}

重要: JSON形式のみを出力してください。表面的な数字の増減ではなく、その背景にある経営判断を読み解いてください。`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Pdf,
              },
            },
            {
              type: 'text',
              text: systemPrompt,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // JSON部分を抽出（```json ... ``` で囲まれている場合も対応）
    let jsonText = textBlock.text.trim();
    const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    return JSON.parse(jsonText) as EarningsSummary;
  }

  // カスタムプロンプトで追加分析（構造化JSON出力）
  async analyzeWithCustomPrompt(
    pdfBuffer: ArrayBuffer,
    customPrompt: string
  ): Promise<CustomAnalysisSummary> {
    const base64Pdf = this.arrayBufferToBase64(pdfBuffer);

    const systemPrompt = `あなたは事業戦略コンサルタントです。ユーザーが指定した観点でこの決算短信を深掘り分析してください。

【ユーザー指定の分析観点】
${customPrompt}

【分析のポイント】
- 表面的な数字ではなく、経営判断の背景と意図を読み解く
- 事業戦略の変化や競争環境への対応を具体的に指摘する
- 将来の事業展開への示唆を含める
- ユーザー指定の観点を中心に分析すること

【出力JSON形式】
{
  "overview": "ユーザー指定の観点から見たこの決算の要点（200-300文字程度）",
  "highlights": [
    "指定観点から見た戦略的にポジティブな点（3-5項目）"
  ],
  "lowlights": [
    "指定観点から見たリスクや課題（3-5項目）"
  ],
  "analysis": "指定観点に基づく詳細な分析（500-800文字程度、具体的な根拠を示す）"
}

重要: JSON形式のみを出力してください。`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Pdf,
              },
            },
            {
              type: 'text',
              text: systemPrompt,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // JSON部分を抽出（```json ... ``` で囲まれている場合も対応）
    let jsonText = textBlock.text.trim();
    const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    return JSON.parse(jsonText) as CustomAnalysisSummary;
  }

  // 過去の決算履歴の型
  static formatPastEarningsContext(
    pastEarnings: Array<{
      fiscal_year: string;
      fiscal_quarter: number;
      summary: EarningsSummary | null;
      highlights: string[];
      lowlights: string[];
    }>
  ): string {
    if (pastEarnings.length === 0) {
      return '';
    }

    const sections = pastEarnings.map((e) => {
      const parts = [`=== ${e.fiscal_year}年 Q${e.fiscal_quarter} ===`];

      if (e.summary?.overview) {
        parts.push(`概要: ${e.summary.overview}`);
      }

      if (e.highlights.length > 0) {
        parts.push(`ハイライト:\n${e.highlights.map(h => `  - ${h}`).join('\n')}`);
      }

      if (e.lowlights.length > 0) {
        parts.push(`ローライト:\n${e.lowlights.map(l => `  - ${l}`).join('\n')}`);
      }

      if (e.summary?.keyMetrics) {
        const m = e.summary.keyMetrics;
        parts.push(`主要指標: 売上${m.revenue} / 営業利益${m.operatingIncome} / 純利益${m.netIncome} / 前年比${m.yoyGrowth}`);
      }

      return parts.join('\n');
    });

    return sections.join('\n\n');
  }

  // チャット用のシステムプロンプトとメッセージを構築
  private buildChatWithPdfParams(
    pdfBuffer: ArrayBuffer,
    currentEarnings: { fiscal_year: string; fiscal_quarter: number; stock_code: string },
    pastEarningsContext: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string
  ): { systemPrompt: string; messages: Anthropic.MessageParam[] } {
    const base64Pdf = this.arrayBufferToBase64(pdfBuffer);

    const systemPrompt = `あなたは事業戦略コンサルタントです。決算資料について、事業家目線で質問に答えてください。

【重要な姿勢】
- 株価や投資リターンには一切言及しない
- 経営判断の背景、事業戦略の意図を深掘りする
- 過去からの経緯、意思決定の連続性を踏まえて回答する
- 具体的なページ番号や記載箇所を示して回答する
- セグメント別の戦略的意思決定を読み解く
- 競争環境の変化と経営の対応を分析する
- 回答はMarkdown形式で構造化して読みやすくする

【現在の決算】
${currentEarnings.stock_code} - ${currentEarnings.fiscal_year}年 Q${currentEarnings.fiscal_quarter}
（添付PDFを参照してください）

${pastEarningsContext ? `【過去の決算履歴（経緯把握用）】\n${pastEarningsContext}` : ''}`;

    // 最初のメッセージにPDFを含める
    const firstUserContent: Anthropic.ContentBlockParam[] = [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64Pdf,
        },
      },
      {
        type: 'text',
        text: chatHistory.length === 0
          ? userMessage
          : '（決算資料PDFを添付しました。以降の質問に回答してください。）',
      },
    ];

    // メッセージ履歴を構築
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: firstUserContent },
    ];

    // 過去の会話履歴がある場合は追加
    if (chatHistory.length > 0) {
      // 最初のuser発言に対するダミーのassistant応答
      messages.push({ role: 'assistant', content: '承知しました。決算資料を確認しました。ご質問をどうぞ。' });

      // 会話履歴を追加
      for (const msg of chatHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }

      // 新しいユーザーメッセージ
      messages.push({ role: 'user', content: userMessage });
    }

    return { systemPrompt, messages };
  }

  // 決算についてのチャット（PDFベース + 過去の経緯）- 非ストリーミング
  async chatWithPdf(
    pdfBuffer: ArrayBuffer,
    currentEarnings: { fiscal_year: string; fiscal_quarter: number; stock_code: string },
    pastEarningsContext: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string
  ): Promise<string> {
    const { systemPrompt, messages } = this.buildChatWithPdfParams(
      pdfBuffer, currentEarnings, pastEarningsContext, chatHistory, userMessage
    );

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    return textBlock.text;
  }

  // 決算についてのチャット（PDFベース + 過去の経緯）- ストリーミング
  async *chatWithPdfStream(
    pdfBuffer: ArrayBuffer,
    currentEarnings: { fiscal_year: string; fiscal_quarter: number; stock_code: string },
    pastEarningsContext: string,
    chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string
  ): AsyncGenerator<string, string, unknown> {
    const { systemPrompt, messages } = this.buildChatWithPdfParams(
      pdfBuffer, currentEarnings, pastEarningsContext, chatHistory, userMessage
    );

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

    let fullContent = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const text = event.delta.text;
        fullContent += text;
        yield text;
      }
    }

    return fullContent;
  }

  // 決算についてのチャット（旧: サマリーベース、フォールバック用）
  async chat(
    earningsSummary: EarningsSummary,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string
  ): Promise<string> {
    const systemPrompt = `あなたは事業戦略コンサルタントです。決算情報について、事業家目線で質問に答えてください。

【重要な姿勢】
- 株価や投資リターンには一切言及しない
- 経営判断の背景、事業戦略の意図を深掘りする
- セグメント別の戦略的意思決定を読み解く
- 競争環境の変化と経営の対応を分析する

決算サマリー:
${JSON.stringify(earningsSummary, null, 2)}`;

    const chatMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...messages,
      { role: 'user', content: userMessage },
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: chatMessages,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    return textBlock.text;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
