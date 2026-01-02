// IRBANK スクレイピングクライアント
// https://irbank.net/ から過去のIR資料を取得

import type { DocumentCandidate } from './documentSources';

export interface IrbankDocument {
  documentId: string;
  stockCode: string;
  title: string;
  pubdate: string; // YYYY-MM-DD
  pdfUrl: string;
}

// IrbankDocument を共通形式に変換
export function toDocumentCandidate(doc: IrbankDocument): DocumentCandidate {
  return {
    pdfUrl: doc.pdfUrl,
    title: doc.title,
    pubdate: doc.pubdate,
    source: 'irbank',
  };
}

export class IrbankClient {
  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  // 銘柄のドキュメントID一覧を取得
  async getDocumentIds(stockCode: string): Promise<string[]> {
    const code = stockCode.slice(0, 4);
    // /ir ページに全IRドキュメントのリストがある（トップページは一部のみ）
    const url = `https://irbank.net/${code}/ir`;

    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
    });

    if (!response.ok) {
      throw new Error(`IRBANK fetch error: ${response.status}`);
    }

    const html = await response.text();

    // href="/7203/140120251105587596" パターンを抽出
    const pattern = new RegExp(`href="/${code}/(\\d+)"`, 'g');
    const matches = [...html.matchAll(pattern)];
    const docIds = [...new Set(matches.map((m) => m[1]))];

    return docIds;
  }

  // ドキュメントページからPDF URLを取得
  async getDocumentInfo(stockCode: string, documentId: string): Promise<IrbankDocument | null> {
    const code = stockCode.slice(0, 4);
    const url = `https://irbank.net/${code}/${documentId}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // PDF URL を抽出: https://f.irbank.net/pdf/YYYYMMDD/documentId.pdf
    const pdfMatch = html.match(/https:\/\/f\.irbank\.net\/pdf\/(\d{8})\/(\d+)\.pdf/);
    if (!pdfMatch) {
      return null;
    }

    // タイトルを抽出
    // IRBankのtitleタグは「4385 メルカリ | FY2026.6 1Q決算説明資料（2025/11/07 15:30提出）」形式
    let title = '';

    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      const fullTitle = titleMatch[1];
      // "銘柄コード 銘柄名 | ドキュメントタイトル（日付）" から抽出
      const pipeIndex = fullTitle.indexOf(' | ');
      if (pipeIndex !== -1) {
        // | 以降を取得し、末尾の（日付）を除去
        title = fullTitle.slice(pipeIndex + 3).replace(/（\d{4}\/\d{2}\/\d{2}[^）]*）$/, '').trim();
      } else {
        // | がない場合は " - " で分割
        title = fullTitle.split(' - ')[0].trim();
      }
    }

    // 日付をYYYY-MM-DD形式に変換
    const dateStr = pdfMatch[1];
    const pubdate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

    return {
      documentId,
      stockCode: code,
      title,
      pubdate,
      pdfUrl: pdfMatch[0],
    };
  }

  // PDFをダウンロード
  async downloadPdf(pdfUrl: string): Promise<ArrayBuffer> {
    const response = await fetch(pdfUrl, {
      headers: { 'User-Agent': this.userAgent },
    });

    if (!response.ok) {
      throw new Error(`PDF download error: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('pdf')) {
      throw new Error(`Not a PDF response: ${contentType}`);
    }

    return response.arrayBuffer();
  }

  // 銘柄の全ドキュメント情報を取得（制限付き）
  async getAllDocuments(stockCode: string, limit: number = 50): Promise<IrbankDocument[]> {
    const docIds = await this.getDocumentIds(stockCode);
    const documents: IrbankDocument[] = [];

    for (const docId of docIds.slice(0, limit)) {
      const doc = await this.getDocumentInfo(stockCode, docId);
      if (doc) {
        documents.push(doc);
      }
      // レート制限対策
      await this.sleep(100);
    }

    return documents;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
