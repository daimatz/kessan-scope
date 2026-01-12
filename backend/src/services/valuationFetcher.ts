// IRBANKからバリュエーションデータ（時価総額）を取得するサービス

export interface MarketCapData {
  date: string;  // YYYY-MM-DD
  marketCap: number;  // 百万円
}

export class ValuationFetcher {
  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  // IRBANKから時価総額の履歴を取得
  async fetchMarketCapHistory(stockCode: string): Promise<MarketCapData[]> {
    const code = stockCode.slice(0, 4);
    const url = `https://irbank.net/${code}/results`;

    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
    });

    if (!response.ok) {
      throw new Error(`IRBANK fetch error: ${response.status}`);
    }

    const html = await response.text();
    const results: MarketCapData[] = [];

    // IRBANKの業績ページから時価総額を抽出
    // テーブル形式: 決算期、売上高、営業利益、純利益、時価総額などが含まれる
    // パターン: <td>時価総額</td> の行を探す

    // 時価総額の行を探す（通常は「時価総額」というラベルの行）
    // 形式は「XX億円」または「XX百万円」
    const marketCapPattern = /<tr[^>]*>.*?時価総額.*?<\/tr>/gis;
    const matches = html.match(marketCapPattern);

    if (matches) {
      for (const match of matches) {
        // 数値を抽出（億円単位）
        const valuePattern = />([\d,]+(?:\.\d+)?)\s*億/g;
        const valueMatches = [...match.matchAll(valuePattern)];

        for (const vm of valueMatches) {
          const value = parseFloat(vm[1].replace(/,/g, ''));
          if (!isNaN(value) && value > 0) {
            results.push({
              date: new Date().toISOString().split('T')[0],
              marketCap: value * 100,  // 億円 → 百万円
            });
          }
        }
      }
    }

    return results;
  }

  // 決算データから財務指標を抽出（keyMetrics の文字列をパース）
  parseFinancialMetrics(keyMetrics: {
    revenue: string;
    operatingIncome: string;
    netIncome: string;
  }): {
    revenue: number | null;
    operatingIncome: number | null;
    netIncome: number | null;
  } {
    return {
      revenue: this.parseJapaneseNumber(keyMetrics.revenue),
      operatingIncome: this.parseJapaneseNumber(keyMetrics.operatingIncome),
      netIncome: this.parseJapaneseNumber(keyMetrics.netIncome),
    };
  }

  // 日本語の数値表記をパース（例: "1,234億円", "12.3億円", "△5.6億円"）
  private parseJapaneseNumber(str: string): number | null {
    if (!str) return null;

    // マイナス記号の処理
    const isNegative = str.includes('△') || str.includes('-') || str.includes('▲');

    // 数値部分を抽出
    const numMatch = str.match(/([\d,]+(?:\.\d+)?)/);
    if (!numMatch) return null;

    let value = parseFloat(numMatch[1].replace(/,/g, ''));
    if (isNaN(value)) return null;

    // 単位の処理
    if (str.includes('兆')) {
      value *= 1000000;  // 兆 → 百万円
    } else if (str.includes('億')) {
      value *= 100;  // 億 → 百万円
    } else if (str.includes('百万')) {
      // そのまま百万円
    } else if (str.includes('千万')) {
      value *= 10;  // 千万 → 百万円
    }

    return isNegative ? -value : value;
  }
}
