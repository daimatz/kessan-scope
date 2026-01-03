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
  getWatchlistItemsWithoutAnalysis,
} from './watchlistQueries';

// 決算関連
export {
  type ReleaseForDashboard,
  getReleasesForDashboard,
  getEarningsById,
  addDocumentUrl,
  checkUrlExists,
  getExistingContentHashes,
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
  // バッチクエリ
  getDocumentsForReleases,
  getUserAnalysesForReleases,
  getAnalysisHistoryCountsForReleases,
} from './releaseQueries';

// チャット関連
export {
  getChatMessagesByRelease,
  addChatMessageForRelease,
} from './analysisQueries';
