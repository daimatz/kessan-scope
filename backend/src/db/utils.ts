// 共通ユーティリティ

export function generateId(): string {
  return crypto.randomUUID();
}

// PBKDF2 パラメータ
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16; // bytes
const HASH_LENGTH = 32; // bytes

// バイト配列を16進文字列に変換
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 16進文字列をバイト配列に変換
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// パスワードハッシュ生成（PBKDF2-SHA256 + Salt）
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();

  // ランダムな salt を生成
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  // パスワードを CryptoKey にインポート
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // PBKDF2 でハッシュを導出
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8 // bits
  );

  const hash = new Uint8Array(hashBuffer);

  // salt:hash の形式で返す
  return `${bytesToHex(salt)}:${bytesToHex(hash)}`;
}

// パスワード検証（新形式: salt:hash、旧形式: hash のみ）
export async function verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
  const encoder = new TextEncoder();

  // 新形式（salt:hash）かどうか判定
  if (storedHash.includes(':')) {
    const [saltHex, hashHex] = storedHash.split(':');
    const salt = hexToBytes(saltHex);
    const expectedHash = hexToBytes(hashHex);

    // パスワードを CryptoKey にインポート
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    // PBKDF2 でハッシュを導出
    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      HASH_LENGTH * 8
    );

    const computedHash = new Uint8Array(hashBuffer);

    // タイミング攻撃対策: 定数時間比較
    if (computedHash.length !== expectedHash.length) return false;
    let result = 0;
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash[i] ^ expectedHash[i];
    }
    return result === 0;
  }

  // 旧形式（SHA-256 のみ、後方互換用）
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return computedHash === storedHash;
}
