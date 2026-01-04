import { z } from 'zod';

// ============================================
// 基本スキーマ
// ============================================

export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const WatchlistItemSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  stock_code: z.string(),
  stock_name: z.string().nullable(),
  custom_prompt: z.string().nullable(),
  created_at: z.string(),
});
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>;

export const StockSchema = z.object({
  code: z.string(),
  name: z.string(),
  market: z.string().nullable(),
  sector: z.string().nullable(),
});
export type Stock = z.infer<typeof StockSchema>;

// ============================================
// 決算関連スキーマ
// ============================================

export const KeyMetricsSchema = z.object({
  revenue: z.string(),
  operatingIncome: z.string(),
  netIncome: z.string(),
  yoyGrowth: z.string(),
});

export const EarningsSummarySchema = z.object({
  overview: z.string(),
  highlights: z.array(z.string()),
  lowlights: z.array(z.string()),
  keyMetrics: KeyMetricsSchema,
});
export type EarningsSummary = z.infer<typeof EarningsSummarySchema>;

export const CustomAnalysisSummarySchema = z.object({
  overview: z.string(),
  highlights: z.array(z.string()),
  lowlights: z.array(z.string()),
  analysis: z.string(),
});
export type CustomAnalysisSummary = z.infer<typeof CustomAnalysisSummarySchema>;

export const ReleaseTypeSchema = z.enum(['quarterly_earnings', 'growth_potential']);
export type ReleaseType = z.infer<typeof ReleaseTypeSchema>;

export const DocumentTypeSchema = z.enum(['earnings_summary', 'earnings_presentation', 'growth_potential']);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

// ============================================
// チャット関連スキーマ
// ============================================

export const ChatMessageSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  release_id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  created_at: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ============================================
// API レスポンススキーマ
// ============================================

// リリース関連
export const ReleaseDocumentSchema = z.object({
  id: z.string(),
  document_type: DocumentTypeSchema,
  document_title: z.string().nullable(),
  r2_key: z.string().nullable(),
  file_size: z.number().nullable(),
  announcement_date: z.string(),
});
export type ReleaseDocument = z.infer<typeof ReleaseDocumentSchema>;

export const ReleaseDetailSchema = z.object({
  id: z.string(),
  release_type: ReleaseTypeSchema,
  stock_code: z.string(),
  stock_name: z.string().nullable(),
  fiscal_year: z.string(),
  fiscal_quarter: z.number().nullable(),
  summary: EarningsSummarySchema.nullable(),
  highlights: z.array(z.string()),
  lowlights: z.array(z.string()),
  documents: z.array(ReleaseDocumentSchema),
});
export type ReleaseDetail = z.infer<typeof ReleaseDetailSchema>;

export const ReleaseNavItemSchema = z.object({
  id: z.string(),
  fiscal_year: z.string(),
  fiscal_quarter: z.number().nullable(),
  release_type: ReleaseTypeSchema,
});
export type ReleaseNavItem = z.infer<typeof ReleaseNavItemSchema>;

export const AnalysisHistoryItemSchema = z.object({
  prompt: z.string(),
  analysis: z.string(),
  created_at: z.string(),
});
export type AnalysisHistoryItem = z.infer<typeof AnalysisHistoryItemSchema>;

export const ReleaseDetailResponseSchema = z.object({
  release: ReleaseDetailSchema,
  customAnalysis: CustomAnalysisSummarySchema.nullable(),
  customPromptUsed: z.string().nullable(),
  notifiedAt: z.string().nullable(),
  analysisHistory: z.array(AnalysisHistoryItemSchema),
  prevRelease: ReleaseNavItemSchema.nullable(),
  nextRelease: ReleaseNavItemSchema.nullable(),
});
export type ReleaseDetailResponse = z.infer<typeof ReleaseDetailResponseSchema>;

// ダッシュボード用
export const DashboardReleaseSchema = z.object({
  id: z.string(),
  release_type: ReleaseTypeSchema,
  stock_code: z.string(),
  stock_name: z.string().nullable(),
  fiscal_year: z.string(),
  fiscal_quarter: z.number().nullable(),
  announcement_date: z.string().nullable(),
  has_summary: z.boolean(),
  has_custom_analysis: z.boolean(),
  notified_at: z.string().nullable(),
  document_count: z.number(),
  documents: z.array(z.object({
    id: z.string(),
    document_type: DocumentTypeSchema,
  })),
});
export type DashboardRelease = z.infer<typeof DashboardReleaseSchema>;

export const ReleaseListItemSchema = z.object({
  id: z.string(),
  release_type: ReleaseTypeSchema,
  fiscal_year: z.string(),
  fiscal_quarter: z.number().nullable(),
  announcement_date: z.string().nullable(),
  has_summary: z.boolean(),
  has_custom_analysis: z.boolean(),
  analysis_history_count: z.number(),
  document_count: z.number(),
  documents: z.array(z.object({
    id: z.string(),
    document_type: DocumentTypeSchema,
    document_title: z.string().nullable(),
    has_pdf: z.boolean(),
  })),
});
export type ReleaseListItem = z.infer<typeof ReleaseListItemSchema>;

export const StockReleasesResponseSchema = z.object({
  stock_code: z.string(),
  stock_name: z.string().nullable(),
  custom_prompt: z.string().nullable(),
  watchlist_id: z.string().nullable(),
  releases: z.array(ReleaseListItemSchema),
});
export type StockReleasesResponse = z.infer<typeof StockReleasesResponseSchema>;

// ============================================
// ユーティリティ関数
// ============================================

export function getDocumentTypeLabel(type: DocumentType): string {
  switch (type) {
    case 'earnings_summary':
      return '決算短信';
    case 'earnings_presentation':
      return '決算説明資料';
    case 'growth_potential':
      return '成長可能性資料';
  }
}

export function getReleaseTypeLabel(type: ReleaseType): string {
  switch (type) {
    case 'quarterly_earnings':
      return '決算発表';
    case 'growth_potential':
      return '成長可能性';
  }
}

export function parseCustomAnalysis(jsonString: string | null): CustomAnalysisSummary | null {
  if (!jsonString) return null;
  try {
    return CustomAnalysisSummarySchema.parse(JSON.parse(jsonString));
  } catch {
    return {
      overview: '',
      highlights: [],
      lowlights: [],
      analysis: jsonString,
    };
  }
}
