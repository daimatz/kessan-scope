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

  constructor(apiKey: string, fromEmail: string, fromName: string = 'Stock Watcher') {
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
      <p>Stock Watcher - 株式ウォッチャー</p>
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

  // メールアドレス確認メールを送信
  async sendVerificationEmail(options: {
    to: EmailRecipient;
    verificationUrl: string;
  }): Promise<void> {
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
    .button { display: inline-block; background: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
    .note { color: #6b7280; font-size: 14px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">📧 メールアドレスの確認</h1>
    </div>
    <div class="content">
      <p>Stock Watcher へのご登録ありがとうございます。</p>
      <p>以下のボタンをクリックして、メールアドレスを確認してください。</p>
      <a href="${options.verificationUrl}" class="button">メールアドレスを確認する →</a>
      <p class="note">このリンクは24時間有効です。<br>心当たりがない場合は、このメールを無視してください。</p>
    </div>
    <div class="footer">
      <p>Stock Watcher - 株式ウォッチャー</p>
    </div>
  </div>
</body>
</html>
`;

    const text = `
Stock Watcher へのご登録ありがとうございます。

以下のリンクをクリックして、メールアドレスを確認してください：
${options.verificationUrl}

このリンクは24時間有効です。
心当たりがない場合は、このメールを無視してください。
`;

    await this.sendEmail({
      to: [options.to],
      subject: '[Stock Watcher] メールアドレスの確認',
      html,
      text,
    });
  }
}
