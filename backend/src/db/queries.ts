// データベースクエリの統合エクスポート
// 各ファイルからすべてのクエリ関数と型をre-export

// 共通ユーティリティ
export { generateId } from './utils';

// ユーザー関連
export {
  getUserByGoogleId,
  getUserById,
  createUser,
  getUserByEmail,
  deleteUser,
  generateVerificationToken,
  createUserWithPassword,
  verifyEmailToken,
  regenerateVerificationToken,
  verifyPassword,
  setUserPassword,
  linkGoogleAccount,
  updateUserSettings,
} from './userQueries';

// ウォッチリスト関連
export {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  updateWatchlistItem,
  getWatchlistByStockCode,
  getWatchlistItemById,
} from './watchlistQueries';

// 決算関連（旧API含む）
export {
  type EarningsWithAnalysis,
  getEarningsForDashboard,
  type ReleaseForDashboard,
  getReleasesForDashboard,
  getEarnings,
  getEarningsById,
  createEarnings,
  addDocumentUrl,
  checkUrlExists,
  getExistingContentHashes,
  updateEarningsAnalysis,
  getEarningsByStockCode,
  createEarningsWithRelease,
} from './earningsQueries';

// リリース関連（新API）
export {
  getOrCreateEarningsRelease,
  getEarningsReleaseById,
  getEarningsReleasesByStockCode,
  getDocumentsForRelease,
  updateEarningsReleaseAnalysis,
  type UserReleaseAnalysis,
  getUserAnalysisByRelease,
  createUserAnalysisForRelease,
  updateUserAnalysisForRelease,
  getDocumentCountForRelease,
  type PastReleaseForChat,
  getPastReleasesForChat,
  type ReleaseAnalysisHistory,
  saveCustomAnalysisForRelease,
  getCustomAnalysisHistoryForRelease,
  findCachedAnalysisForRelease,
} from './releaseQueries';

// 分析・チャット関連
export {
  getUserEarningsAnalysis,
  createUserEarningsAnalysis,
  markAsNotified,
  getChatMessages,
  addChatMessage,
  getChatMessagesByRelease,
  addChatMessageForRelease,
  saveCustomAnalysisToHistory,
  getCustomAnalysisHistory,
  updateUserEarningsAnalysis,
  findCachedAnalysis,
  getUniquePromptsForStock,
  type AnalysisByPrompt,
  getAllAnalysesForEarnings,
  type PastEarningsForChat,
  getPastEarningsForChat,
} from './analysisQueries';
