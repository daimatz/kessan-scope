// ドキュメントソース統合
// TDnet と IRBANK の両方からドキュメントを取得し、統合する

import { TdnetClient, TdnetDocument, isStrategicDocument, determineFiscalYear, determineFiscalQuarter, getDocumentType } from './tdnet';
import { IrbankClient, toDocumentCandidate } from './irbank';
import { DocumentClassifier, DocumentClassification } from './documentClassifier';
import { LLM_BATCH_SIZE } from '../constants';

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

// LLM分類結果付きドキュメント
export interface ClassifiedDocument extends DocumentCandidate {
  classification: DocumentClassification;
}

// LLM で分類してフィルタリング
export async function classifyDocuments(
  candidates: DocumentCandidate[],
  openaiApiKey: string
): Promise<ClassifiedDocument[]> {
  const classifier = new DocumentClassifier(openaiApiKey);
  const results: ClassifiedDocument[] = [];

  // バッチ処理（LLM_BATCH_SIZE 件ずつ並列）
  for (let i = 0; i < candidates.length; i += LLM_BATCH_SIZE) {
    const batch = candidates.slice(i, i + LLM_BATCH_SIZE);

    const classifications = await Promise.all(
      batch.map((doc) => classifier.classify(doc.title, doc.pubdate))
    );

    for (let j = 0; j < batch.length; j++) {
      const classification = classifications[j];
      // 'other' 以外のみ対象
      if (classification.document_type !== 'other') {
        results.push({
          ...batch[j],
          classification,
        });
      } else {
        console.log(`Skipped by LLM (other): ${batch[j].title}`);
      }
    }
  }

  return results;
}

// 年度・四半期を判定（エクスポート - 旧ロジック互換用）
export { determineFiscalYear, determineFiscalQuarter, getDocumentType };

// LLM分類関連もエクスポート
export { DocumentClassifier };
export type { DocumentClassification };
