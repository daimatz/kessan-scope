// Mailgun API Client

const MAILGUN_API_BASE = 'https://api.mailgun.net/v3';

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

export class MailgunClient {
  private apiKey: string;
  private domain: string;
  private fromEmail: string;
  private fromName: string;

  constructor(apiKey: string, domain: string, fromEmail: string, fromName: string = 'Kessan Scope') {
    this.apiKey = apiKey;
    this.domain = domain;
    this.fromEmail = fromEmail;
    this.fromName = fromName;
  }

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const formData = new FormData();
    formData.append('from', `${this.fromName} <${this.fromEmail}>`);

    for (const recipient of options.to) {
      const to = recipient.name
        ? `${recipient.name} <${recipient.email}>`
        : recipient.email;
      formData.append('to', to);
    }

    formData.append('subject', options.subject);
    formData.append('html', options.html);
    if (options.text) {
      formData.append('text', options.text);
    }

    const response = await fetch(`${MAILGUN_API_BASE}/${this.domain}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${this.apiKey}`)}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mailgun error: ${response.status} - ${error}`);
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
      <p>このメールは分析リストに基づいて自動送信されています。</p>
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

  // 登録ありがとうメールを送信
  async sendWelcomeEmail(options: {
    to: EmailRecipient;
    dashboardUrl: string;
  }): Promise<void> {
    const userName = options.to.name || 'ユーザー';

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
    .feature { margin-bottom: 15px; padding-left: 10px; border-left: 3px solid #1e40af; }
    .feature-title { font-weight: bold; color: #1e40af; }
    .button { display: inline-block; background: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">🎉 ご登録ありがとうございます</h1>
      <p style="margin: 10px 0 0;">Kessan Scope へようこそ！</p>
    </div>
    <div class="content">
      <p>${userName} さん、</p>
      <p>Kessan Scope にご登録いただきありがとうございます。</p>
      <p>Kessan Scope は、上場企業の決算資料をAIが自動分析し、投資判断に役立つインサイトを提供するサービスです。</p>

      <h3 style="color: #1e40af; margin-top: 25px;">主な機能</h3>
      <div class="feature">
        <div class="feature-title">📊 決算資料の自動分析</div>
        <p style="margin: 5px 0;">決算短信やIR資料をAIが分析し、ハイライト・ローライトを自動抽出</p>
      </div>
      <div class="feature">
        <div class="feature-title">🔔 新着決算通知</div>
        <p style="margin: 5px 0;">ウォッチリストに登録した銘柄の新着決算を自動でお知らせ</p>
      </div>
      <div class="feature">
        <div class="feature-title">📈 カスタム分析</div>
        <p style="margin: 5px 0;">独自の視点でAI分析をカスタマイズ可能</p>
      </div>

      <p style="margin-top: 25px;">さっそく銘柄を登録して、決算分析を始めましょう！</p>
      <a href="${options.dashboardUrl}" class="button">ダッシュボードを開く →</a>
    </div>
    <div class="footer">
      <p>Kessan Scope</p>
      <p>ご不明な点がございましたら、お気軽にお問い合わせください。</p>
    </div>
  </div>
</body>
</html>
`;

    const text = `
${userName} さん、

Kessan Scope にご登録いただきありがとうございます。

Kessan Scope は、上場企業の決算資料をAIが自動分析し、投資判断に役立つインサイトを提供するサービスです。

主な機能:
- 決算資料の自動分析: 決算短信やIR資料をAIが分析し、ハイライト・ローライトを自動抽出
- 新着決算通知: ウォッチリストに登録した銘柄の新着決算を自動でお知らせ
- カスタム分析: 独自の視点でAI分析をカスタマイズ可能

さっそく銘柄を登録して、決算分析を始めましょう！

ダッシュボード: ${options.dashboardUrl}
`;

    await this.sendEmail({
      to: [options.to],
      subject: '[Kessan Scope] ご登録ありがとうございます',
      html,
      text,
    });
  }
}
