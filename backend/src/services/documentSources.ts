// ドキュメントソース統合
// TDnet と IRBANK の両方からドキュメントを取得し、統合する

import { TdnetClient, TdnetDocument, isStrategicDocument, determineFiscalYear, determineFiscalQuarter, getDocumentType } from './tdnet';
import { IrbankClient, toDocumentCandidate } from './irbank';

// 共通のドキュメント形式
export interface DocumentCandidate {
  pdfUrl: string;
  title: string;
  pubdate: string;  // YYYY-MM-DD
  source: 'tdnet' | 'irbank';
}

// TdnetDocument を共通形式に変換
function tdnetToCandidate(doc: TdnetDocument): DocumentCandidate {
  return {
    pdfUrl: doc.document_url,
    title: doc.title,
    pubdate: doc.pubdate.split(' ')[0],  // "2025-11-05 14:25:00" → "2025-11-05"
    source: 'tdnet',
  };
}

// 銘柄のドキュメント候補を両ソースから取得
export async function getDocumentCandidates(
  stockCode: string,
  options: { tdnetLimit?: number; irbankLimit?: number } = {}
): Promise<DocumentCandidate[]> {
  const { tdnetLimit = 100, irbankLimit = 100 } = options;
  const candidates: DocumentCandidate[] = [];
  const seenUrls = new Set<string>();

  // TDnet から取得
  console.log(`Fetching from TDnet for ${stockCode}...`);
  try {
    const tdnetClient = new TdnetClient();
    const tdnetDocs = await tdnetClient.getDocumentsByStock(stockCode);
    const strategicDocs = tdnetClient.filterStrategicDocuments(tdnetDocs);

    for (const doc of strategicDocs.slice(0, tdnetLimit)) {
      const candidate = tdnetToCandidate(doc);
      if (!seenUrls.has(candidate.pdfUrl)) {
        seenUrls.add(candidate.pdfUrl);
        candidates.push(candidate);
      }
    }
    console.log(`TDnet: ${candidates.length} strategic documents`);
  } catch (error) {
    console.error(`TDnet fetch failed:`, error);
  }

  // IRBANK から取得
  console.log(`Fetching from IRBANK for ${stockCode}...`);
  try {
    const irbankClient = new IrbankClient();
    const irbankDocs = await irbankClient.getAllDocuments(stockCode, irbankLimit);

    let added = 0;
    for (const doc of irbankDocs) {
      // 戦略的ドキュメントかチェック
      if (!isStrategicDocument(doc.title)) {
        continue;
      }
      const candidate = toDocumentCandidate(doc);
      if (!seenUrls.has(candidate.pdfUrl)) {
        seenUrls.add(candidate.pdfUrl);
        candidates.push(candidate);
        added++;
      }
    }
    console.log(`IRBANK: ${added} additional strategic documents`);
  } catch (error) {
    console.error(`IRBANK fetch failed:`, error);
  }

  console.log(`Total candidates: ${candidates.length}`);
  return candidates;
}

// 年度・四半期を判定（エクスポート）
export { determineFiscalYear, determineFiscalQuarter, getDocumentType };
