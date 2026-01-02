// PDF ストレージサービス
// 各ソース（TDnet/IRBANK）から PDF を取得し、R2 に保存

export interface StoredPdf {
  contentHash: string;  // MD5 ハッシュ
  r2Key: string;        // R2 オブジェクトキー
  buffer: ArrayBuffer;  // PDF データ
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// MD5 ハッシュを計算
async function calculateMd5(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('MD5', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// PDF を取得（汎用）
export async function fetchPdf(pdfUrl: string): Promise<ArrayBuffer | null> {
  // rd.php リダイレクトを処理（TDnet）
  const actualUrl = pdfUrl.includes('rd.php?')
    ? pdfUrl.split('rd.php?')[1]
    : pdfUrl;

  try {
    const response = await fetch(actualUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) {
      console.log(`PDF fetch failed (${response.status}): ${actualUrl}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('pdf')) {
      console.log(`Not a PDF response: ${contentType}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    console.log(`PDF fetched: ${buffer.byteLength} bytes from ${actualUrl}`);
    return buffer;
  } catch (error) {
    console.error(`PDF fetch error:`, error);
    return null;
  }
}

// PDF を R2 に保存
export async function storePdf(
  bucket: R2Bucket,
  buffer: ArrayBuffer,
  stockCode: string
): Promise<StoredPdf> {
  const contentHash = await calculateMd5(buffer);

  // R2 キー: {stockCode}/{hash}.pdf
  const r2Key = `${stockCode}/${contentHash}.pdf`;

  // R2 に保存
  await bucket.put(r2Key, buffer, {
    httpMetadata: {
      contentType: 'application/pdf',
    },
  });

  console.log(`PDF stored in R2: ${r2Key} (${buffer.byteLength} bytes)`);

  return {
    contentHash,
    r2Key,
    buffer,
  };
}

// R2 から PDF を取得
export async function getPdfFromR2(
  bucket: R2Bucket,
  r2Key: string
): Promise<ArrayBuffer | null> {
  const object = await bucket.get(r2Key);
  if (!object) {
    return null;
  }
  return object.arrayBuffer();
}

// PDF を取得して R2 に保存（重複チェック込み）
export async function fetchAndStorePdf(
  bucket: R2Bucket,
  pdfUrl: string,
  stockCode: string,
  existingHashes: Set<string>,
  checkUrlFn: (url: string) => Promise<string | null>
): Promise<StoredPdf | null> {
  // URL で既存チェック（インデックス検索、O(log n)）
  const existingId = await checkUrlFn(pdfUrl);
  if (existingId) {
    return null;  // 既に保存済み
  }

  // PDF を取得
  const buffer = await fetchPdf(pdfUrl);
  if (!buffer) {
    return null;  // 取得失敗
  }

  // ハッシュを計算
  const contentHash = await calculateMd5(buffer);

  // 既存のハッシュと比較（同内容・別URLのケース）
  if (existingHashes.has(contentHash)) {
    console.log(`Same content from different URL (hash: ${contentHash})`);
    return null;
  }

  // R2 に保存
  return storePdf(bucket, buffer, stockCode);
}
