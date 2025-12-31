import OpenAI from 'openai';
import type { EarningsSummary } from '../types';

export class OpenAIService {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  setModel(model: string) {
    this.model = model;
  }

  // PDF画像から決算内容を解析
  async analyzeEarningsPdf(pdfImages: string[]): Promise<EarningsSummary> {
    const systemPrompt = `あなたは日本株の決算分析の専門家です。
決算短信の画像を分析し、以下の情報をJSON形式で抽出してください。

出力JSON形式:
{
  "overview": "決算の総評（200文字程度）",
  "highlights": ["良かった点を1つずつリスト"],
  "lowlights": ["懸念事項を1つずつリスト"],
  "keyMetrics": {
    "revenue": "売上高（単位付き）",
    "operatingIncome": "営業利益（単位付き）",
    "netIncome": "純利益（単位付き）",
    "yoyGrowth": "前年同期比成長率"
  }
}

日本語で回答してください。`;

    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: '以下の決算短信の画像を分析してください。' },
      ...pdfImages.map(base64 => ({
        type: 'image_url' as const,
        image_url: {
          url: `data:image/png;base64,${base64}`,
          detail: 'high' as const,
        },
      })),
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    });

    const result = response.choices[0]?.message?.content;
    if (!result) {
      throw new Error('No response from OpenAI');
    }

    return JSON.parse(result) as EarningsSummary;
  }

  // カスタムプロンプトで追加分析
  async analyzeWithCustomPrompt(
    earningsSummary: EarningsSummary,
    customPrompt: string
  ): Promise<string> {
    const systemPrompt = `あなたは日本株の決算分析の専門家です。
ユーザーが指定した観点で決算を分析してください。`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `決算サマリー:
${JSON.stringify(earningsSummary, null, 2)}

分析観点:
${customPrompt}

上記の観点でこの決算を分析してください。`,
        },
      ],
      max_tokens: 2048,
    });

    return response.choices[0]?.message?.content || '';
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

    const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: chatMessages,
      max_tokens: 2048,
    });

    return response.choices[0]?.message?.content || '';
  }
}
