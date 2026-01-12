// IRBANKからバリュエーションデータ（時価総額）を取得するサービス

export interface FinancialData {
  fiscalYear: string;
  fiscalQuarter: number | null;
  recordDate: string;
  marketCap: number | null;  // 百万円
  revenue: number | null;    // 百万円
  operatingIncome: number | null;  // 百万円
}

export class ValuationFetcher {
  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  // 銘柄コードからEDINETコードを取得
  private async getEdinetCode(stockCode: string): Promise<string | null> {
    const code = stockCode.slice(0, 4);
    const url = `https://irbank.net/${code}`;

    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
    });

    if (!response.ok) return null;

    const html = await response.text();
    // パターン: href="/E02144"
    const match = html.match(/href="\/(E\d+)"/);
    return match ? match[1] : null;
  }

  // IRBANKから時価総額データを取得（四半期単位）
  async fetchFinancialHistory(stockCode: string): Promise<FinancialData[]> {
    const code = stockCode.slice(0, 4);

    // 複数年のデータを取得（各リクエストで約1年分のデータが取得可能）
    const allData: FinancialData[] = [];
    const seenKeys = new Set<string>();
    const currentYear = new Date().getFullYear();

    // 過去10年分をカバーするため、各年の6月末と12月末でリクエスト
    const targetDates: (string | null)[] = [null]; // 現在
    for (let year = currentYear - 1; year >= currentYear - 5; year--) {
      targetDates.push(`${year}-06-30`);
      targetDates.push(`${year}-12-31`);
    }

    for (const date of targetDates) {
      const capUrl = date
        ? `https://irbank.net/${code}/cap?y=${date}`
        : `https://irbank.net/${code}/cap`;
      try {
        const capResponse = await fetch(capUrl, {
          headers: { 'User-Agent': this.userAgent },
        });

        if (!capResponse.ok) continue;

        const capHtml = await capResponse.text();
        const marketCapData = this.parseCapPage(capHtml);

        // 重複を除いて追加
        for (const d of marketCapData) {
          const key = `${d.fiscalYear}-Q${d.fiscalQuarter}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allData.push(d);
          }
        }
      } catch (e) {
        console.error(`Failed to fetch ${capUrl}:`, e);
      }
    }

    return allData.sort((a, b) => a.recordDate.localeCompare(b.recordDate));
  }

  // capページから時価総額をパース（四半期末データを抽出）
  private parseCapPage(html: string): FinancialData[] {
    const dailyData: { date: string; year: string; month: string; day: string; marketCap: number }[] = [];

    // 年ヘッダーを追跡するため、現在の年を保持
    let currentYear = '';

    // 年ヘッダー: <tr id="c2026" class="occ"><td class="lf weaken" colspan="11">2026</td></tr>
    // データ行: <td class="lf weaken"><a ...>01/09</a></td>...<td class="rt weaken">53兆5134億</td>
    const yearPattern = /<tr id="c(\d{4})"[^>]*class="occ"[^>]*>/g;
    const rowPattern = /<tr[^>]*class="(?:odd|obb)"[^>]*>[\s\S]*?<td[^>]*><a[^>]*>(\d{2})\/(\d{2})<\/a><\/td>[\s\S]*?<td class="rt weaken">([^<]*兆?[^<]*億?)<\/td>/g;

    // HTMLを行ごとに分割して処理
    const lines = html.split('</tr>');
    for (const line of lines) {
      // 年ヘッダーをチェック
      const yearMatch = line.match(/<tr id="c(\d{4})"[^>]*class="occ"[^>]*>/);
      if (yearMatch) {
        currentYear = yearMatch[1];
        continue;
      }

      // データ行をチェック
      if (currentYear && (line.includes('class="odd"') || line.includes('class="obb"'))) {
        // 日付パターン: <a ...>01/09</a> または ただの 01/09
        const dateMatch = line.match(/<a[^>]*>(\d{2})\/(\d{2})<\/a>/) ||
                          line.match(/<td class="lf weaken">(\d{2})\/(\d{2})<\/td>/);
        // 時価総額のパターン: 53兆5134億, 307億4286万, 307億, 1兆 など
        const capMatch = line.match(/<td class="rt weaken">(\d+兆[\d,]+億[\d,]*万?|\d+億[\d,]*万?|\d+兆[\d,]*億?)<\/td>/);

        if (dateMatch && capMatch) {
          const month = dateMatch[1];
          const day = dateMatch[2];
          const marketCap = this.parseJapaneseNumber(capMatch[1]);

          if (marketCap !== null) {
            dailyData.push({
              date: `${currentYear}-${month}-${day}`,
              year: currentYear,
              month,
              day,
              marketCap,
            });
          }
        }
      }
    }

    // 四半期末の日付を特定（3月末、6月末、9月末、12月末）
    const quarterEndMonths = ['03', '06', '09', '12'];
    const quarterlyData: FinancialData[] = [];

    // 年-四半期ごとにグループ化（会計年度で）
    const groupedByQuarter = new Map<string, typeof dailyData>();

    for (const d of dailyData) {
      const { fiscalYear, fiscalQuarter } = this.getFiscalPeriod(d.year, d.month);
      const key = `${fiscalYear}-Q${fiscalQuarter}`;
      if (!groupedByQuarter.has(key)) {
        groupedByQuarter.set(key, []);
      }
      groupedByQuarter.get(key)!.push(d);
    }

    // 各四半期の最後の日付のデータを取得
    for (const [key, data] of groupedByQuarter) {
      // 日付でソートして最後の日付を取得
      data.sort((a, b) => a.date.localeCompare(b.date));
      const lastData = data[data.length - 1];

      const [fiscalYear, quarterStr] = key.split('-Q');
      const fiscalQuarter = parseInt(quarterStr);

      quarterlyData.push({
        fiscalYear,
        fiscalQuarter,
        recordDate: lastData.date,
        marketCap: lastData.marketCap,
        revenue: null,
        operatingIncome: null,
      });
    }

    // 現在進行中の四半期を除外（四半期末に達していないデータ）
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const { fiscalYear: currentFY, fiscalQuarter: currentQ } = this.getFiscalPeriod(
      String(todayYear),
      String(todayMonth).padStart(2, '0')
    );

    const completedQuarters = quarterlyData.filter(q => {
      // 現在の会計年度・四半期より前のものだけを含める
      if (q.fiscalYear < currentFY) return true;
      if (q.fiscalYear === currentFY && q.fiscalQuarter < currentQ) return true;
      return false;
    });

    return completedQuarters.sort((a, b) => a.recordDate.localeCompare(b.recordDate));
  }

  // 特定の日付の時価総額を取得
  async fetchMarketCapAtDate(stockCode: string, date: string): Promise<number | null> {
    const code = stockCode.slice(0, 4);
    const capUrl = `https://irbank.net/${code}/cap?y=${date}`;

    try {
      const response = await fetch(capUrl, {
        headers: { 'User-Agent': this.userAgent },
      });

      if (!response.ok) return null;

      const html = await response.text();

      // 指定日付またはその前後の時価総額を探す
      const targetDate = new Date(date);
      let closestData: { date: Date; marketCap: number } | null = null;
      let minDiff = Infinity;

      // HTMLを行ごとに分割して処理
      let currentYear = '';
      const lines = html.split('</tr>');

      for (const line of lines) {
        // 年ヘッダーをチェック
        const yearMatch = line.match(/<tr id="c(\d{4})"[^>]*class="occ"[^>]*>/);
        if (yearMatch) {
          currentYear = yearMatch[1];
          continue;
        }

        // データ行をチェック
        if (currentYear && (line.includes('class="odd"') || line.includes('class="obb"'))) {
          const dateMatch = line.match(/<a[^>]*>(\d{2})\/(\d{2})<\/a>/) ||
                            line.match(/<td class="lf weaken">(\d{2})\/(\d{2})<\/td>/);
          const capMatch = line.match(/<td class="rt weaken">(\d+兆[\d,]+億[\d,]*万?|\d+億[\d,]*万?|\d+兆[\d,]*億?)<\/td>/);

          if (dateMatch && capMatch) {
            const month = dateMatch[1];
            const day = dateMatch[2];
            const rowDate = new Date(`${currentYear}-${month}-${day}`);
            const marketCap = this.parseJapaneseNumber(capMatch[1]);

            if (marketCap !== null) {
              const diff = Math.abs(rowDate.getTime() - targetDate.getTime());
              if (diff < minDiff) {
                minDiff = diff;
                closestData = { date: rowDate, marketCap };
              }
            }
          }
        }
      }

      // 7日以内のデータのみ採用
      if (closestData && minDiff <= 7 * 24 * 60 * 60 * 1000) {
        return closestData.marketCap;
      }

      return null;
    } catch (e) {
      console.error(`Failed to fetch market cap at ${date}:`, e);
      return null;
    }
  }

  // カレンダー年月から会計年度と四半期を取得（3月決算を想定）
  private getFiscalPeriod(calendarYear: string, month: string): { fiscalYear: string; fiscalQuarter: number } {
    const m = parseInt(month);
    const y = parseInt(calendarYear);

    // 3月決算の場合:
    // 1-3月 → その年のQ4 (例: 2026年1月 → FY2026 Q4)
    // 4-6月 → 翌年度のQ1 (例: 2025年6月 → FY2026 Q1)
    // 7-9月 → 翌年度のQ2 (例: 2025年9月 → FY2026 Q2)
    // 10-12月 → 翌年度のQ3 (例: 2025年12月 → FY2026 Q3)
    if (m >= 1 && m <= 3) {
      return { fiscalYear: String(y), fiscalQuarter: 4 };
    } else if (m >= 4 && m <= 6) {
      return { fiscalYear: String(y + 1), fiscalQuarter: 1 };
    } else if (m >= 7 && m <= 9) {
      return { fiscalYear: String(y + 1), fiscalQuarter: 2 };
    } else {
      return { fiscalYear: String(y + 1), fiscalQuarter: 3 };
    }
  }

  // valuationページから時価総額をパース
  private parseValuationPage(html: string): FinancialData[] {
    const results: FinancialData[] = [];

    // c_graph1セクション（時価総額）内のdlを抽出
    // パターン: id="c_graph1"....<dl class="gdl...">...</dl>
    const sectionMatch = html.match(/id="c_graph1"[\s\S]*?<dl class="gdl[^"]*">([\s\S]*?)<\/dl>/);
    if (!sectionMatch) {
      // テーブルから取得を試みる
      return this.parseValuationTable(html);
    }

    const dlContent = sectionMatch[1];

    // <dt>と<dd>のペアを抽出
    // dt: <dt>2010年3月31日</dt> または <dt>2011年3月31日<span...>...</span></dt>
    // dd: <dd><span class="ratio"...></span><span class="text">12兆9127億</span></dd>
    const pairPattern = /<dt>(\d{4})年(\d{1,2})月(\d{1,2})?日?(?:<span[^>]*>[^<]*<\/span>)?<\/dt>\s*<dd>(?:<span[^>]*>[^<]*<\/span>\s*)?<span class="text">([^<]+)<\/span><\/dd>/g;

    for (const match of dlContent.matchAll(pairPattern)) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3] ? match[3].padStart(2, '0') : '01';
      const valueStr = match[4];

      const marketCap = this.parseJapaneseNumber(valueStr);
      if (marketCap !== null) {
        results.push({
          fiscalYear: year,
          fiscalQuarter: null,
          recordDate: `${year}-${month}-${day}`,
          marketCap,
          revenue: null,
          operatingIncome: null,
        });
      }
    }

    return results.sort((a, b) => a.recordDate.localeCompare(b.recordDate));
  }

  // テーブル形式から時価総額をパース
  private parseValuationTable(html: string): FinancialData[] {
    const results: FinancialData[] = [];

    // テーブル行から抽出
    // パターン: <td class="rt"><a ...>2010/03/31</a></td><td class="rt">...<span class="text">12.9兆</span></td>
    const rowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*><a[^>]*>(\d{4})\/(\d{2})\/(\d{2})<\/a><\/td>\s*<td[^>]*>[^<]*<span[^>]*>[^<]*<\/span>\s*<span class="text">([^<]+)<\/span><\/td>/g;

    for (const match of html.matchAll(rowPattern)) {
      const year = match[1];
      const month = match[2];
      const day = match[3];
      const valueStr = match[4];

      const marketCap = this.parseJapaneseNumber(valueStr);
      if (marketCap !== null) {
        results.push({
          fiscalYear: year,
          fiscalQuarter: null,
          recordDate: `${year}-${month}-${day}`,
          marketCap,
          revenue: null,
          operatingIncome: null,
        });
      }
    }

    return results.sort((a, b) => a.recordDate.localeCompare(b.recordDate));
  }

  // 業績データをマージ
  private mergeFinancialData(data: FinancialData[], plHtml: string): void {
    // 売上高と営業利益のテーブルから年度ごとのデータを抽出
    // ここでは簡易的に実装。必要に応じて拡張。
  }

  // 日本語の数値表記をパース（例: "12兆9127億", "307億4286万", "12.9兆", "△5.6億"）
  parseJapaneseNumber(str: string): number | null {
    if (!str || str === '-' || str === '－' || str === '—') return null;

    // マイナス記号の処理
    const isNegative = str.includes('△') || str.includes('▲') || str.startsWith('-');

    let value = 0;

    // 兆の部分を抽出
    const choMatch = str.match(/([\d,]+(?:\.\d+)?)\s*兆/);
    if (choMatch) {
      const cho = parseFloat(choMatch[1].replace(/,/g, ''));
      if (!isNaN(cho)) {
        value += cho * 1000000;  // 兆 → 百万円
      }
    }

    // 億の部分を抽出
    const okuMatch = str.match(/([\d,]+(?:\.\d+)?)\s*億/);
    if (okuMatch) {
      const oku = parseFloat(okuMatch[1].replace(/,/g, ''));
      if (!isNaN(oku)) {
        value += oku * 100;  // 億 → 百万円
      }
    }

    // 万の部分を抽出
    const manMatch = str.match(/([\d,]+(?:\.\d+)?)\s*万/);
    if (manMatch) {
      const man = parseFloat(manMatch[1].replace(/,/g, ''));
      if (!isNaN(man)) {
        value += man * 0.01;  // 万 → 百万円
      }
    }

    // いずれの単位も見つからない場合、数値のみを抽出（百万円単位として扱う）
    if (value === 0) {
      const numMatch = str.match(/([\d,]+(?:\.\d+)?)/);
      if (!numMatch) return null;
      value = parseFloat(numMatch[1].replace(/,/g, ''));
      if (isNaN(value)) return null;
    }

    return isNegative ? -value : value;
  }
}
