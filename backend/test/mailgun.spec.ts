import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MailgunClient } from '../src/services/mailgun';

// グローバル fetch のモック
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('MailgunClient', () => {
  let client: MailgunClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MailgunClient('test-api-key', 'mg.example.com', 'test@example.com');
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
        'https://api.mailgun.net/v3/mg.example.com/messages',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': `Basic ${btoa('api:test-api-key')}`,
          },
        })
      );
    });

    it('FormData で正しいリクエストボディを送信する', async () => {
      await client.sendEmail({
        to: [{ email: 'recipient@example.com', name: 'Test User' }],
        subject: 'Test Subject',
        html: '<p>Test Body</p>',
        text: 'Test Body',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as FormData;

      expect(body.get('from')).toBe('Kessan Scope <test@example.com>');
      expect(body.get('to')).toBe('Test User <recipient@example.com>');
      expect(body.get('subject')).toBe('Test Subject');
      expect(body.get('html')).toBe('<p>Test Body</p>');
      expect(body.get('text')).toBe('Test Body');
    });

    it('複数の宛先を送信できる', async () => {
      await client.sendEmail({
        to: [
          { email: 'user1@example.com', name: 'User 1' },
          { email: 'user2@example.com' },
        ],
        subject: 'Test Subject',
        html: '<p>Test Body</p>',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as FormData;

      const toValues = body.getAll('to');
      expect(toValues).toContain('User 1 <user1@example.com>');
      expect(toValues).toContain('user2@example.com');
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
      ).rejects.toThrow('Mailgun error: 401 - Unauthorized');
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
      const body = callArgs[1].body as FormData;

      expect(body.get('subject')).toBe('[決算通知] トヨタ自動車 (7203) 2025年 Q2');
      expect(body.get('to')).toBe('User <user@example.com>');
      expect(body.get('html')).toContain('売上高が過去最高');
      expect(body.get('html')).toContain('原材料コスト上昇');
      expect(body.get('html')).toContain('https://example.com/detail');
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
      const body = callArgs[1].body as FormData;

      expect(body.get('html')).toContain('情報なし');
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
      const body = callArgs[1].body as FormData;

      expect(body.get('subject')).toBe('[Kessan Scope] トヨタ自動車 (7203) のインポートが完了しました');
      expect(body.get('html')).toContain('10');
      expect(body.get('html')).toContain('2');
      expect(body.get('html')).toContain('https://example.com/dashboard');
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
      const body = callArgs[1].body as FormData;

      expect(body.get('subject')).toBe('[Kessan Scope] 7203 のインポートが完了しました');
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
      const body = callArgs[1].body as FormData;

      expect(body.get('subject')).toBe('[Kessan Scope] トヨタ自動車 (7203) の再分析が完了しました');
      expect(body.get('html')).toContain('5'); // regenerated
      expect(body.get('html')).toContain('3'); // cached
      expect(body.get('html')).toContain('10'); // total
      expect(body.get('html')).toContain('2'); // skipped
    });
  });

  describe('カスタム fromName', () => {
    it('カスタム fromName を設定できる', async () => {
      const customClient = new MailgunClient('test-api-key', 'mg.example.com', 'test@example.com', 'Custom Name');

      await customClient.sendEmail({
        to: [{ email: 'recipient@example.com' }],
        subject: 'Test',
        html: '<p>Test</p>',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = callArgs[1].body as FormData;

      expect(body.get('from')).toBe('Custom Name <test@example.com>');
    });
  });
});
