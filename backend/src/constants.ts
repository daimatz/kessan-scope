// アプリケーション定数

// ========================================
// API制限・バッチ処理
// ========================================

// LLM分類のバッチサイズ（OpenAI API レート制限考慮）
export const LLM_BATCH_SIZE = 10;

// アプリ側の並列処理数（Claude API / Queue と組み合わせ）
export const PARALLEL_LIMIT = 3;

// ========================================
// PDF処理
// ========================================

// Claude API の PDF ページ数上限
export const MAX_PDF_PAGES = 100;

// Claude API の PDF サイズ上限（32MB）
export const MAX_PDF_SIZE = 32 * 1024 * 1024;

// 1回の分析で使用する最大PDF数（コスト考慮）
export const MAX_PDFS_PER_ANALYSIS = 2;

// ========================================
// TDnet
// ========================================

// TDnet から取得する最新ドキュメント数
export const TDNET_RECENT_DOCS_LIMIT = 300;
