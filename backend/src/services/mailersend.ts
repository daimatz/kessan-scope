// MailerSend API Client

const MAILERSEND_API_BASE = 'https://api.mailersend.com/v1';

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface SendEmailOptions {
  to: EmailRecipient[];
  subject: string;
  html: string;
  text?: string;
}

export class MailerSendClient {
  private apiKey: string;
  private fromEmail: string;
  private fromName: string;

  constructor(apiKey: string, fromEmail: string, fromName: string = 'Kessan Scope') {
    this.apiKey = apiKey;
    this.fromEmail = fromEmail;
    this.fromName = fromName;
  }

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const response = await fetch(`${MAILERSEND_API_BASE}/email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: {
          email: this.fromEmail,
          name: this.fromName,
        },
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MailerSend error: ${response.status} - ${error}`);
    }
  }

  // 決算通知メールを送信
  async sendEarningsNotification(options: {
    to: EmailRecipient;
    stockCode: string;
    stockName: string;
    fiscalYear: string;
    fiscalQuarter: number;
    highlights: string[];
    lowlights: string[];
    detailUrl: string;
  }): Promise<void> {
    const quarterName = `${options.fiscalYear}年 Q${options.fiscalQuarter}`;
    
    const highlightsHtml = options.highlights
      .map(h => `<li style="color: #16a34a;">✅ ${h}</li>`)
      .join('');
    
    const lowlightsHtml = options.lowlights
      .map(l => `<li style="color: #dc2626;">⚠️ ${l}</li>`)
      .join('');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .section { margin-bottom: 20px; }
    .section-title { font-weight: bold; font-size: 16px; margin-bottom: 10px; }
    ul { padding-left: 20px; }
    li { margin-bottom: 8px; }
    .button { display: inline-block; background: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">📈 決算通知</h1>
      <p style="margin: 10px 0 0;">${options.stockName} (${options.stockCode}) ${quarterName}</p>
    </div>
    <div class="content">
      <div class="section">
        <div class="section-title">ハイライト</div>
        <ul>${highlightsHtml || '<li>情報なし</li>'}</ul>
      </div>
      <div class="section">
        <div class="section-title">ローライト</div>
        <ul>${lowlightsHtml || '<li>情報なし</li>'}</ul>
      </div>
      <a href="${options.detailUrl}" class="button">詳細を見る →</a>
    </div>
    <div class="footer">
      <p>Kessan Scope</p>
      <p>このメールはウォッチリストに基づいて自動送信されています。</p>
    </div>
  </div>
</body>
</html>
`;

    const text = `
決算通知: ${options.stockName} (${options.stockCode}) ${quarterName}

ハイライト:
${options.highlights.map(h => `- ${h}`).join('\n')}

ローライト:
${options.lowlights.map(l => `- ${l}`).join('\n')}

詳細: ${options.detailUrl}
`;

    await this.sendEmail({
      to: [options.to],
      subject: `[決算通知] ${options.stockName} (${options.stockCode}) ${quarterName}`,
      html,
      text,
    });
  }

  // インポート完了通知メールを送信
  async sendImportCompleteEmail(options: {
    to: EmailRecipient;
    stockCode: string;
    stockName: string | null;
    imported: number;
    skipped: number;
    dashboardUrl: string;
  }): Promise<void> {
    const displayName = options.stockName
      ? `${options.stockName} (${options.stockCode})`
      : options.stockCode;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #059669; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .stats { display: flex; gap: 20px; margin: 20px 0; }
    .stat { background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; flex: 1; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #1e40af; }
    .stat-label { font-size: 12px; color: #6b7280; }
    .button { display: inline-block; background: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">✅ インポート完了</h1>
      <p style="margin: 10px 0 0;">${displayName}</p>
    </div>
    <div class="content">
      <p>過去の決算資料・IR資料のインポートが完了しました。</p>
      <div class="stats">
        <div class="stat">
          <div class="stat-value">${options.imported}</div>
          <div class="stat-label">インポート済み</div>
        </div>
        <div class="stat">
          <div class="stat-value">${options.skipped}</div>
          <div class="stat-label">スキップ</div>
        </div>
      </div>
      <p>インポートされた資料はAIによる分析が完了しています。ダッシュボードで確認できます。</p>
      <a href="${options.dashboardUrl}" class="button">ダッシュボードを開く →</a>
    </div>
    <div class="footer">
      <p>Kessan Scope</p>
    </div>
  </div>
</body>
</html>
`;

    const text = `
インポート完了: ${displayName}

過去の決算資料・IR資料のインポートが完了しました。

- インポート済み: ${options.imported} 件
- スキップ: ${options.skipped} 件

ダッシュボード: ${options.dashboardUrl}
`;

    await this.sendEmail({
      to: [options.to],
      subject: `[Kessan Scope] ${displayName} のインポートが完了しました`,
      html,
      text,
    });
  }

  // 再分析完了通知メールを送信
  async sendRegenerateCompleteEmail(options: {
    to: EmailRecipient;
    stockCode: string;
    stockName: string | null;
    regenerated: number;
    cached: number;
    total: number;
    skipped: number;
    dashboardUrl: string;
  }): Promise<void> {
    const displayName = options.stockName
      ? `${options.stockName} (${options.stockCode})`
      : options.stockCode;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #7c3aed; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .stats { display: flex; gap: 10px; margin: 20px 0; flex-wrap: wrap; }
    .stat { background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; flex: 1; text-align: center; min-width: 80px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #7c3aed; }
    .stat-label { font-size: 12px; color: #6b7280; }
    .button { display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">🔄 再分析完了</h1>
      <p style="margin: 10px 0 0;">${displayName}</p>
    </div>
    <div class="content">
      <p>カスタムプロンプトによる再分析が完了しました。</p>
      <div class="stats">
        <div class="stat">
          <div class="stat-value">${options.regenerated}</div>
          <div class="stat-label">新規分析</div>
        </div>
        <div class="stat">
          <div class="stat-value">${options.cached}</div>
          <div class="stat-label">キャッシュ</div>
        </div>
        <div class="stat">
          <div class="stat-value">${options.skipped}</div>
          <div class="stat-label">スキップ</div>
        </div>
        <div class="stat">
          <div class="stat-value">${options.total}</div>
          <div class="stat-label">合計</div>
        </div>
      </div>
      <p>新しい分析結果はダッシュボードで確認できます。過去の分析結果も履歴として保存されています。</p>
      <a href="${options.dashboardUrl}" class="button">ダッシュボードを開く →</a>
    </div>
    <div class="footer">
      <p>Kessan Scope</p>
    </div>
  </div>
</body>
</html>
`;

    const text = `
再分析完了: ${displayName}

カスタムプロンプトによる再分析が完了しました。

- 新規分析: ${options.regenerated} 件
- キャッシュ: ${options.cached} 件
- スキップ: ${options.skipped} 件
- 合計: ${options.total} 件

ダッシュボード: ${options.dashboardUrl}
`;

    await this.sendEmail({
      to: [options.to],
      subject: `[Kessan Scope] ${displayName} の再分析が完了しました`,
      html,
      text,
    });
  }
}
