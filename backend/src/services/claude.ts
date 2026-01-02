import Anthropic from '@anthropic-ai/sdk';
import type { EarningsSummary } from '../types';

export class ClaudeService {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  // PDFから決算内容を解析
  async analyzeEarningsPdf(pdfBuffer: ArrayBuffer): Promise<EarningsSummary> {
    const base64Pdf = this.arrayBufferToBase64(pdfBuffer);

    const systemPrompt = `あなたは日本株の決算分析の専門家です。
決算短信PDFを分析し、以下の情報をJSON形式で抽出してください。

出力JSON形式:
{
  "overview": "決算の総評（200文字程度）",
  "highlights": ["良かった点を1つずつリスト（3-5項目）"],
  "lowlights": ["懸念事項を1つずつリスト（3-5項目）"],
  "keyMetrics": {
    "revenue": "売上高（単位付き）",
    "operatingIncome": "営業利益（単位付き）",
    "netIncome": "純利益（単位付き）",
    "yoyGrowth": "前年同期比成長率"
  }
}

重要: JSON形式のみを出力してください。説明文は不要です。`;

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

  // カスタムプロンプトで追加分析
  async analyzeWithCustomPrompt(
    pdfBuffer: ArrayBuffer,
    customPrompt: string
  ): Promise<string> {
    const base64Pdf = this.arrayBufferToBase64(pdfBuffer);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
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
              text: `あなたは日本株の決算分析の専門家です。
以下の観点でこの決算短信を分析してください。

分析観点:
${customPrompt}

日本語で、具体的な数字を引用しながら分析してください。`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    return textBlock.text;
  }

  // 決算についてのチャット
  async chat(
    earningsSummary: EarningsSummary,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string
  ): Promise<string> {
    const systemPrompt = `あなたは日本株の決算分析の専門家です。
以下の決算情報について、ユーザーの質問に答えてください。

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
