import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MailerSendClient } from '../src/services/mailersend';

// グローバル fetch のモック
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('MailerSendClient', () => {
  let client: MailerSendClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MailerSendClient('test-api-key', 'test@example.com');
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
  });

  describe('sendEmail', () => {
    it('正しい API エンドポイントに POST リクエストを送る', async () => {
      await client.sendEmail({
        to: [{ email: 'recipient@example.com', name: 'Test User' }],
        subject: 'Test Subject',
        html: '<p>Test Body</p>',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.mailersend.com/v1/email',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('正しいリクエストボディを送信する', async () => {
      await client.sendEmail({
        to: [{ email: 'recipient@example.com', name: 'Test User' }],
        subject: 'Test Subject',
        html: '<p>Test Body</p>',
        text: 'Test Body',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body).toEqual({
        from: {
          email: 'test@example.com',
          name: 'Kessan Scope',
        },
        to: [{ email: 'recipient@example.com', name: 'Test User' }],
        subject: 'Test Subject',
        html: '<p>Test Body</p>',
        text: 'Test Body',
      });
    });

    it('API エラー時に例外をスローする', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      await expect(
        client.sendEmail({
          to: [{ email: 'recipient@example.com' }],
          subject: 'Test',
          html: '<p>Test</p>',
        })
      ).rejects.toThrow('MailerSend error: 401 - Unauthorized');
    });
  });

  describe('sendEarningsNotification', () => {
    it('決算通知メールを送信する', async () => {
      await client.sendEarningsNotification({
        to: { email: 'user@example.com', name: 'User' },
        stockCode: '7203',
        stockName: 'トヨタ自動車',
        fiscalYear: '2025',
        fiscalQuarter: 2,
        highlights: ['売上高が過去最高', '営業利益率改善'],
        lowlights: ['原材料コスト上昇'],
        detailUrl: 'https://example.com/detail',
      });

      expect(mockFetch).toHaveBeenCalled();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.subject).toBe('[決算通知] トヨタ自動車 (7203) 2025年 Q2');
      expect(body.to).toEqual([{ email: 'user@example.com', name: 'User' }]);
      expect(body.html).toContain('売上高が過去最高');
      expect(body.html).toContain('原材料コスト上昇');
      expect(body.html).toContain('https://example.com/detail');
    });

    it('ハイライト・ローライトが空でも送信できる', async () => {
      await client.sendEarningsNotification({
        to: { email: 'user@example.com' },
        stockCode: '7203',
        stockName: 'トヨタ自動車',
        fiscalYear: '2025',
        fiscalQuarter: 2,
        highlights: [],
        lowlights: [],
        detailUrl: 'https://example.com/detail',
      });

      expect(mockFetch).toHaveBeenCalled();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.html).toContain('情報なし');
    });
  });

  describe('sendImportCompleteEmail', () => {
    it('インポート完了メールを送信する', async () => {
      await client.sendImportCompleteEmail({
        to: { email: 'user@example.com', name: 'User' },
        stockCode: '7203',
        stockName: 'トヨタ自動車',
        imported: 10,
        skipped: 2,
        dashboardUrl: 'https://example.com/dashboard',
      });

      expect(mockFetch).toHaveBeenCalled();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.subject).toBe('[Kessan Scope] トヨタ自動車 (7203) のインポートが完了しました');
      expect(body.html).toContain('10');
      expect(body.html).toContain('2');
      expect(body.html).toContain('https://example.com/dashboard');
    });

    it('stockName がない場合は stockCode のみ表示する', async () => {
      await client.sendImportCompleteEmail({
        to: { email: 'user@example.com' },
        stockCode: '7203',
        stockName: null,
        imported: 10,
        skipped: 2,
        dashboardUrl: 'https://example.com/dashboard',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.subject).toBe('[Kessan Scope] 7203 のインポートが完了しました');
    });
  });

  describe('sendRegenerateCompleteEmail', () => {
    it('再分析完了メールを送信する', async () => {
      await client.sendRegenerateCompleteEmail({
        to: { email: 'user@example.com', name: 'User' },
        stockCode: '7203',
        stockName: 'トヨタ自動車',
        regenerated: 5,
        cached: 3,
        total: 10,
        skipped: 2,
        dashboardUrl: 'https://example.com/dashboard',
      });

      expect(mockFetch).toHaveBeenCalled();

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.subject).toBe('[Kessan Scope] トヨタ自動車 (7203) の再分析が完了しました');
      expect(body.html).toContain('5'); // regenerated
      expect(body.html).toContain('3'); // cached
      expect(body.html).toContain('10'); // total
      expect(body.html).toContain('2'); // skipped
    });
  });

  describe('カスタム fromName', () => {
    it('カスタム fromName を設定できる', async () => {
      const customClient = new MailerSendClient('test-api-key', 'test@example.com', 'Custom Name');

      await customClient.sendEmail({
        to: [{ email: 'recipient@example.com' }],
        subject: 'Test',
        html: '<p>Test</p>',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.from.name).toBe('Custom Name');
    });
  });
});
