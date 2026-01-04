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

  // /ir ページから全ドキュメント情報を取得（1リクエストのみ）
  async getAllDocuments(stockCode: string, limit: number = 100): Promise<IrbankDocument[]> {
    const code = stockCode.slice(0, 4);
    const url = `https://irbank.net/${code}/ir`;

    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
    });

    if (!response.ok) {
      throw new Error(`IRBANK fetch error: ${response.status}`);
    }

    const html = await response.text();
    const documents: IrbankDocument[] = [];

    // <dt>日付</dt> と <dd><a title="..." href="...">...</a></dd> のペアを抽出
    // パターン: <dt>YYYY/MM/DD</dt> の後に続く <dd><a ... href="/code/docId" title="...">
    // 注意: 1つの日付に複数のドキュメントがある場合がある

    // まず全ての <a> タグで title と href を持つものを抽出
    // title="銘柄コード 銘柄名 | タイトル（YYYY/MM/DD HH:MM提出）" href="/code/docId"
    const linkPattern = new RegExp(
      `<a[^>]*title="[^|]+\\|\\s*([^（]+)（(\\d{4}/\\d{2}/\\d{2})[^）]*）"[^>]*href="/${code}/(\\d+)"`,
      'g'
    );

    for (const match of html.matchAll(linkPattern)) {
      if (documents.length >= limit) break;

      const title = match[1].trim();
      const dateStr = match[2]; // YYYY/MM/DD
      const documentId = match[3];

      // 日付を YYYY-MM-DD 形式に変換
      const pubdate = dateStr.replace(/\//g, '-');
      // 日付を YYYYMMDD 形式に変換（PDF URL用）
      const dateForUrl = dateStr.replace(/\//g, '');

      // PDF URL を推測
      const pdfUrl = `https://f.irbank.net/pdf/${dateForUrl}/${documentId}.pdf`;

      documents.push({
        documentId,
        stockCode: code,
        title,
        pubdate,
        pdfUrl,
      });
    }

    return documents;
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
}
