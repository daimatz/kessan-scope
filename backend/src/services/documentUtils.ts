// ドキュメント分類関連ユーティリティ
// historicalImport.ts と newReleasesChecker.ts で共通利用

import type { DocumentType, ReleaseType } from '../types';

// LLM分類結果を DocumentType に変換
export function classificationToDocumentType(classType: string): DocumentType | null {
  switch (classType) {
    case 'earnings_summary':
      return 'earnings_summary';
    case 'earnings_presentation':
      return 'earnings_presentation';
    case 'growth_potential':
      return 'growth_potential';
    case 'mid_term_plan':
      return 'mid_term_plan';
    default:
      return null;
  }
}

// DocumentType から ReleaseType を決定
export function determineReleaseType(docType: DocumentType): ReleaseType {
  if (docType === 'growth_potential') {
    return 'growth_potential';
  }
  if (docType === 'mid_term_plan') {
    return 'mid_term_plan';
  }
  return 'quarterly_earnings';
}
