// EDINET API Client
// https://disclosure.edinet-fsa.go.jp/

const EDINET_API_BASE = 'https://api.edinet-fsa.go.jp/api/v2';

export interface EdinetDocument {
  docID: string;
  edinetCode: string;
  secCode: string | null; // 証券コード（4桁）
  JCN: string;
  filerName: string;
  fundCode: string | null;
  ordinanceCode: string;
  formCode: string;
  docTypeCode: string;
  periodStart: string | null;
  periodEnd: string | null;
  submitDateTime: string;
  docDescription: string;
  issuerEdinetCode: string | null;
  subjectEdinetCode: string | null;
  subsidiaryEdinetCode: string | null;
  currentReportReason: string | null;
  parentDocID: string | null;
  opeDateTime: string | null;
  withdrawalStatus: string;
  docInfoEditStatus: string;
  disclosureStatus: string;
  xbrlFlag: string;
  pdfFlag: string;
  attachDocFlag: string;
  englishDocFlag: string;
  csvFlag: string;
  legalStatus: string;
}

export interface EdinetDocumentListResponse {
  metadata: {
    title: string;
    parameter: {
      date: string;
      type: string;
    };
    resultset: {
      count: number;
    };
    processDateTime: string;
    status: string;
    message: string;
  };
  results: EdinetDocument[];
}

// 決算短信のdocTypeCode
const EARNINGS_REPORT_DOC_TYPES = [
  '140', // 四半期報告書
  '150', // 半期報告書
  '160', // 臨時報告書
];

// 決算短信のformCode
const EARNINGS_SUMMARY_FORM_CODES = [
  '043000', // 四半期決算短信
];

export class EdinetClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // 指定日の書類一覧を取得
  async getDocumentList(date: string): Promise<EdinetDocument[]> {
    const url = new URL(`${EDINET_API_BASE}/documents.json`);
    url.searchParams.set('date', date);
    url.searchParams.set('type', '2'); // 書類一覧（メタデータあり）
    url.searchParams.set('Subscription-Key', this.apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`EDINET API error: ${response.status}`);
    }

    const data = await response.json() as EdinetDocumentListResponse;
    return data.results || [];
  }

  // 決算短信をフィルタリング
  filterEarningsReports(documents: EdinetDocument[], stockCodes: string[]): EdinetDocument[] {
    const stockCodeSet = new Set(stockCodes);
    
    return documents.filter(doc => {
      // 証券コードがウォッチリストに含まれるか
      if (!doc.secCode || !stockCodeSet.has(doc.secCode.slice(0, 4))) {
        return false;
      }

      // 決算短信かどうか（書類説明に「決算短信」が含まれる）
      if (doc.docDescription && doc.docDescription.includes('決算短信')) {
        return true;
      }

      return false;
    });
  }

  // 書類PDFを取得
  async getDocumentPdf(docId: string): Promise<ArrayBuffer> {
    const url = new URL(`${EDINET_API_BASE}/documents/${docId}`);
    url.searchParams.set('type', '2'); // PDF
    url.searchParams.set('Subscription-Key', this.apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`EDINET document fetch error: ${response.status}`);
    }

    return response.arrayBuffer();
  }

  // 書類XBRLを取得（ZIP形式）
  async getDocumentXbrl(docId: string): Promise<ArrayBuffer> {
    const url = new URL(`${EDINET_API_BASE}/documents/${docId}`);
    url.searchParams.set('type', '1'); // XBRL (ZIP)
    url.searchParams.set('Subscription-Key', this.apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`EDINET document fetch error: ${response.status}`);
    }

    return response.arrayBuffer();
  }

  // 四半期を判定
  static determineFiscalQuarter(periodEnd: string | null): number {
    if (!periodEnd) return 0;
    
    const month = parseInt(periodEnd.split('-')[1], 10);
    // 一般的な3月決算企業の場合
    if (month === 6) return 1;  // 1Q
    if (month === 9) return 2;  // 2Q
    if (month === 12) return 3; // 3Q
    if (month === 3) return 4;  // 4Q
    
    // その他の決算月の場合は月から推定
    return Math.ceil(month / 3);
  }

  // 年度を判定
  static determineFiscalYear(periodEnd: string | null): string {
    if (!periodEnd) return '';
    
    const [year, month] = periodEnd.split('-').map(Number);
    // 3月決算の場合、1-3月は前年度
    if (month <= 3) {
      return String(year);
    }
    return String(year);
  }
}
