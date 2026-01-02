import { describe, it, expect } from 'vitest';
import {
  isEarningsSummary,
  isEarningsPresentation,
  isMidTermPlan,
  isStrategyDocument,
  isStrategicDocument,
  determineFiscalYear,
  determineFiscalQuarter,
  getDocumentType,
} from '../src/services/tdnet';

describe('tdnet パターンマッチング', () => {
  describe('isEarningsSummary - 決算短信判定', () => {
    it('決算短信を正しく判定', () => {
      const cases = [
        '2026年3月期第2四半期(中間期)決算短信〔IFRS〕(連結)',
        '平成26年3月期決算短信〔米国基準〕(連結)',
        '2025年6月期決算短信〔日本基準〕(連結)',
        '2017年度決算短信〔米国基準〕(連結)',
        '2026年3月期中間決算短信(連結)',
      ];
      cases.forEach((title) => {
        expect(isEarningsSummary(title), title).toBe(true);
      });
    });

    it('決算短信以外を正しく除外', () => {
      const cases = [
        '2026年3月期第2四半期決算報告プレゼンテーション資料',
        '業績予想の修正に関するお知らせ',
        '配当予想の修正について',
        'FY2026.6 1Q決算説明資料',
      ];
      cases.forEach((title) => {
        expect(isEarningsSummary(title), title).toBe(false);
      });
    });
  });

  describe('isEarningsPresentation - 決算説明資料判定', () => {
    it('決算説明資料を正しく判定', () => {
      const cases = [
        '2026年3月期第2四半期決算報告プレゼンテーション資料',
        'FY2026.6 1Q決算説明資料',
        '2025年3月期決算説明会資料',
        '2026年2月期第2四半期(中間期)決算説明資料',
        '決算補足資料',
        '業績説明資料',
        '投資家説明会資料',
        'Earnings Presentation Q1 2025',
        'Financial Results FY2025',
        '決算概要',
        '業績概要',
        'IR資料',
        // 100社検証で追加されたパターン
        '2025年度第2四半期(中間期)決算報告',
        '2026年3月期第2四半期(中間期)決算参考資料',
        '2025年度第2四半期決算について',
        '日産自動車、2025度上期決算を発表',
        '2023年度第2四半期決算',
        '2025年12月期第3四半期連結決算の概要',
        '2026年3月期第2四半期決算Fact Sheet',
      ];
      cases.forEach((title) => {
        expect(isEarningsPresentation(title), title).toBe(true);
      });
    });

    it('決算説明資料以外を正しく除外', () => {
      const cases = [
        '2026年3月期第2四半期決算短信〔IFRS〕(連結)',
        '業績予想の修正に関するお知らせ',
        '配当予想について',
        '自己株式の取得について',
      ];
      cases.forEach((title) => {
        expect(isEarningsPresentation(title), title).toBe(false);
      });
    });
  });

  describe('isMidTermPlan - 中期経営計画判定', () => {
    it('中期経営計画を正しく判定', () => {
      const cases = [
        '中期経営計画（2024-2027）',
        '新中期経営方針について',
        '経営計画の策定について',
        '事業計画のお知らせ',
        '長期ビジョン2030',
        '成長戦略について',
      ];
      cases.forEach((title) => {
        expect(isMidTermPlan(title), title).toBe(true);
      });
    });
  });

  describe('isStrategyDocument - 事業戦略資料判定', () => {
    it('事業戦略資料を正しく判定', () => {
      const cases = [
        '事業戦略説明会資料',
        '経営戦略について',
        '事業説明会資料',
        '事業方針について',
        '資本政策について',
        '株主還元方針',
        'IR説明会資料',
        'IRプレゼンテーション',
        '事業ポートフォリオ見直し',
      ];
      cases.forEach((title) => {
        expect(isStrategyDocument(title), title).toBe(true);
      });
    });
  });

  describe('isStrategicDocument - 統合判定', () => {
    it('対象ドキュメントを正しく判定', () => {
      const targetCases = [
        '2026年3月期第2四半期決算短信〔IFRS〕(連結)',
        '2026年3月期第2四半期決算報告プレゼンテーション資料',
        '中期経営計画（2024-2027）',
        '事業戦略説明会資料',
      ];
      targetCases.forEach((title) => {
        expect(isStrategicDocument(title), title).toBe(true);
      });
    });

    it('対象外ドキュメントを正しく除外', () => {
      const nonTargetCases = [
        '業績予想の修正に関するお知らせ',
        '配当予想の修正について',
        '自己株式の取得について',
        '役員人事に関するお知らせ',
        '連結子会社(楽天証券株式会社)の決算について',
        '株式分割および配当予想について',
      ];
      nonTargetCases.forEach((title) => {
        expect(isStrategicDocument(title), title).toBe(false);
      });
    });
  });

  describe('determineFiscalYear - 年度判定', () => {
    describe('西暦パターン (XXXX年X月期)', () => {
      it.each([
        ['2026年3月期第2四半期決算短信〔IFRS〕(連結)', '2025'],
        ['2025年6月期決算短信〔日本基準〕(連結)', '2024'],
        ['2019年3月期決算短信〔米国基準〕(連結)', '2018'],
        ['2026年2月期第1四半期決算短信〔日本基準〕(連結)', '2025'],
        ['2025年12月期第3四半期決算短信〔IFRS〕(連結)', '2024'],
      ])('%s → %s年', (title, expected) => {
        expect(determineFiscalYear(title)).toBe(expected);
      });
    });

    describe('和暦パターン (平成XX年X月期)', () => {
      it.each([
        ['平成26年3月期決算短信〔米国基準〕(連結)', '2013'],
        ['平成27年3月期第1四半期決算短信〔米国基準〕(連結)', '2014'],
        ['平成30年6月期決算短信〔日本基準〕(連結)', '2017'],
        ['平成31年3月期第2四半期決算短信〔米国基準〕(連結)', '2018'],
      ])('%s → %s年', (title, expected) => {
        expect(determineFiscalYear(title)).toBe(expected);
      });
    });

    describe('和暦変則パターン (平成XX年度X月期)', () => {
      it.each([
        ['平成28年度3月期第3四半期決算短信〔米国基準〕(連結)', '2015'],
      ])('%s → %s年', (title, expected) => {
        expect(determineFiscalYear(title)).toBe(expected);
      });
    });

    describe('年度パターン (XXXX年度)', () => {
      it.each([
        ['2017年度決算短信〔米国基準〕(連結)', '2017'],
        ['2024年度第3四半期決算短信〔IFRS〕(連結)', '2024'],
        ['2025年度第2四半期(中間期)決算短信〔IFRS〕(連結)', '2025'],
        // 100社検証で追加: 「年」が省略されたパターン
        ['日産自動車、2025度上期決算を発表', '2025'],
      ])('%s → %s年', (title, expected) => {
        expect(determineFiscalYear(title)).toBe(expected);
      });
    });

    describe('FYパターン (FY2026.6)', () => {
      it.each([
        ['FY2026.6 1Q決算説明資料', '2025'],
        ['FY2025.3 決算説明資料', '2024'],
        ['FY2024 Annual Report', '2023'],
      ])('%s → %s年', (title, expected) => {
        expect(determineFiscalYear(title)).toBe(expected);
      });
    });

    describe('発表日からのフォールバック', () => {
      it('年度表記がない場合は発表日から判定', () => {
        expect(determineFiscalYear('中期経営計画について', '2025-05-10')).toBe('2025');
      });

      it('年度も発表日もない場合は空文字', () => {
        expect(determineFiscalYear('中期経営計画について')).toBe('');
      });
    });
  });

  describe('determineFiscalQuarter - 四半期判定', () => {
    describe('第X四半期パターン', () => {
      it.each([
        ['2026年3月期第1四半期決算短信〔IFRS〕(連結)', 1],
        ['2026年3月期第2四半期決算短信〔IFRS〕(連結)', 2],
        ['2025年3月期第3四半期決算短信〔IFRS〕(連結)', 3],
        ['2025年3月期第4四半期決算短信〔IFRS〕(連結)', 4],
        ['平成27年3月期第１四半期決算短信〔米国基準〕(連結)', 1],
        ['平成27年3月期第２四半期決算短信〔米国基準〕(連結)', 2],
        ['平成27年3月期第３四半期決算短信〔米国基準〕(連結)', 3],
      ])('%s → Q%d', (title, expected) => {
        expect(determineFiscalQuarter(title)).toBe(expected);
      });
    });

    describe('1Q/Q1パターン', () => {
      it.each([
        ['FY2026.6 1Q決算説明資料', 1],
        ['FY2026.6 2Q決算説明資料', 2],
        ['FY2026.6 3Q決算説明資料', 3],
        ['FY2026.6 4Q決算説明資料', 4],
        ['Q1 2025 Earnings Presentation', 1],
        ['Q2 2025 Earnings Presentation', 2],
      ])('%s → Q%d', (title, expected) => {
        expect(determineFiscalQuarter(title)).toBe(expected);
      });
    });

    describe('中間期・上期パターン', () => {
      it.each([
        ['2026年3月期第2四半期(中間期)決算短信〔IFRS〕(連結)', 2],
        ['2026年3月期中間決算短信(連結)', 2],
        ['中間期決算説明資料', 2],
        // 100社検証で追加された上期パターン
        ['2026年3月期上期決算説明会資料', 2],
        ['日産自動車、2025度上期決算を発表', 2],
      ])('%s → Q%d', (title, expected) => {
        expect(determineFiscalQuarter(title)).toBe(expected);
      });
    });

    describe('通期/期末パターン', () => {
      it.each([
        ['2025年3月期決算短信〔IFRS〕(連結)', 4],
        ['2025年6月期決算短信〔日本基準〕(連結)', 4],
        ['通期決算説明資料', 4],
        ['期末決算説明資料', 4],
        ['Full Year 2024 Results', 4],
        ['Annual Report 2024', 4],
      ])('%s → Q%d', (title, expected) => {
        expect(determineFiscalQuarter(title)).toBe(expected);
      });
    });

    describe('中期経営計画・事業戦略は四半期なし', () => {
      it.each([
        ['中期経営計画（2024-2027）', 0],
        ['新中期経営方針について', 0],
        ['事業戦略説明会資料', 0],
        ['経営戦略について', 0],
        ['資本政策について', 0],
      ])('%s → Q%d', (title, expected) => {
        expect(determineFiscalQuarter(title)).toBe(expected);
      });
    });
  });

  describe('getDocumentType - ドキュメントタイプ判定', () => {
    it.each([
      ['2026年3月期第2四半期決算短信〔IFRS〕(連結)', 'earnings_summary'],
      ['2026年3月期第2四半期決算報告プレゼンテーション資料', 'earnings_presentation'],
      ['中期経営計画（2024-2027）', 'midterm_plan'],
      // 「事業戦略説明会資料」は「説明会資料」で先にマッチするため earnings_presentation
      ['事業戦略説明会資料', 'earnings_presentation'],
      // 純粋な事業戦略資料
      ['事業戦略について', 'strategy'],
      ['資本政策について', 'strategy'],
      ['業績予想の修正に関するお知らせ', 'other'],
    ])('%s → %s', (title, expected) => {
      expect(getDocumentType(title)).toBe(expected);
    });
  });

  describe('実データ検証 - 10社10年分のパターン', () => {
    describe('トヨタ (7203) - 2013-2024', () => {
      const toyotaDocs = [
        { title: '平成26年3月期第2四半期決算短信〔米国基準〕(連結)', year: '2013', q: 2 },
        { title: '平成26年3月期決算短信〔米国基準〕(連結)', year: '2013', q: 4 },
        { title: '平成30年3月期決算短信〔米国基準〕(連結)', year: '2017', q: 4 },
        { title: '2019年3月期決算短信〔米国基準〕(連結)', year: '2018', q: 4 },
        { title: '2021年3月期第1四半期決算短信〔IFRS〕(連結)', year: '2020', q: 1 },
        { title: '2026年3月期第2四半期決算報告プレゼンテーション資料', year: '2025', q: 2 },
      ];

      it.each(toyotaDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });

    describe('メルカリ (4385) - 2018-2024', () => {
      const mercariDocs = [
        { title: '平成30年6月期決算短信〔日本基準〕(連結)', year: '2017', q: 4 },
        { title: '2019年6月期第1四半期決算短信〔日本基準〕(連結)', year: '2018', q: 1 },
        { title: '2022年6月期決算短信〔日本基準〕(連結)', year: '2021', q: 4 },
        { title: 'FY2026.6 1Q決算説明資料', year: '2025', q: 1 },
      ];

      it.each(mercariDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });

    describe('NTT (9432) - 2013-2024', () => {
      const nttDocs = [
        { title: '平成26年3月期第2四半期決算短信(米国基準)(連結)', year: '2013', q: 2 },
        { title: '平成28年度3月期第3四半期決算短信〔米国基準〕(連結)', year: '2015', q: 3 },
        { title: '2017年度決算短信〔米国基準〕(連結)', year: '2017', q: 4 },
        { title: '2018年度第1四半期決算短信〔IFRS〕(連結)', year: '2018', q: 1 },
        { title: '2025年度第2四半期(中間期)決算短信〔IFRS〕(連結)', year: '2025', q: 2 },
      ];

      it.each(nttDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });

    describe('三菱UFJ (8306) - 2013-2024', () => {
      const mufgDocs = [
        { title: '平成26年3月期第2四半期(中間期)決算短信〔日本基準〕(連結)', year: '2013', q: 2 },
        { title: '平成28年3月期中間決算短信(連結)', year: '2015', q: 2 },
        { title: '2018年3月期中間決算短信(連結)', year: '2017', q: 2 },
        { title: '2026年3月期第1四半期決算短信〔日本基準〕(連結)', year: '2025', q: 1 },
      ];

      it.each(mufgDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });

    describe('ソニー (6758) - 2013-2024', () => {
      const sonyDocs = [
        { title: '平成26年3月期第2四半期決算短信〔米国基準〕(連結)', year: '2013', q: 2 },
        { title: '平成29年3月期決算短信〔米国基準〕(連結)', year: '2016', q: 4 },
        { title: '2026年3月期第2四半期(中間期)決算短信〔IFRS〕(連結)', year: '2025', q: 2 },
      ];

      it.each(sonyDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });

    describe('楽天 (4755)', () => {
      const rakutenDocs = [
        { title: '2025年12月期第3四半期決算短信〔IFRS〕(連結)', year: '2024', q: 3 },
        { title: '2024年12月期決算短信〔IFRS〕(連結)', year: '2023', q: 4 },
      ];

      it.each(rakutenDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });

      it('子会社決算は対象外', () => {
        expect(isStrategicDocument('連結子会社(楽天証券株式会社)の決算について')).toBe(false);
      });
    });

    describe('キーエンス (6861)', () => {
      const keyenceDocs = [
        { title: '2026年3月期第2四半期(中間期)決算短信〔日本基準〕(連結)', year: '2025', q: 2 },
        { title: '2025年3月期決算短信〔日本基準〕(連結)', year: '2024', q: 4 },
      ];

      it.each(keyenceDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });

    describe('JT (2914)', () => {
      const jtDocs = [
        { title: '2025年12月期第3四半期決算短信〔IFRS〕(連結)', year: '2024', q: 3 },
        { title: '2025年12月期第2四半期(中間期)決算短信〔IFRS〕(連結)', year: '2024', q: 2 },
      ];

      it.each(jtDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });

    describe('セブン&アイ (3382)', () => {
      const sevenDocs = [
        { title: '2026年2月期第2四半期(中間期)決算説明資料', year: '2025', q: 2 },
        { title: '2026年2月期第1四半期決算短信〔日本基準〕(連結)', year: '2025', q: 1 },
        { title: '2025年2月期決算短信〔日本基準〕(連結)', year: '2024', q: 4 },
      ];

      it.each(sevenDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });

    describe('ソフトバンクG (9984)', () => {
      const sbgDocs = [
        { title: '2026年3月期第2四半期(中間期)決算短信〔IFRS〕(連結)', year: '2025', q: 2 },
        { title: '2025年3月期決算短信〔IFRS〕(連結)', year: '2024', q: 4 },
      ];

      it.each(sbgDocs)('$title', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });

    describe('100社検証 - 追加パターン', () => {
      const additionalDocs = [
        // 決算説明会資料バリエーション
        { title: '2026年3月期第2四半期決算説明会資料', year: '2025', q: 2 },
        { title: '2025年度第2四半期決算説明資料', year: '2025', q: 2 },
        { title: '2025年度第2四半期決算ハイライト', year: '2025', q: 2 },
        { title: '2025年12月期第3四半期決算説明会資料', year: '2024', q: 3 },
        { title: '2026年2月期第2四半期決算補足資料', year: '2025', q: 2 },
        { title: 'Daigasグループ2026年3月期第2四半期決算プレゼンテーション資料', year: '2025', q: 2 },
        { title: '2026年3月期第2四半期決算アナリスト向け説明会資料', year: '2025', q: 2 },
        { title: '2025年度第2四半期決算について', year: '2025', q: 2 },
        { title: '2025年度第2四半期(中間期)決算報告', year: '2025', q: 2 },
        { title: '2026年3月期第2四半期(中間期)決算説明', year: '2025', q: 2 },
        { title: '2026年3月期第2四半期(中間期)決算補足資料', year: '2025', q: 2 },
        { title: '2026年3月期第2四半期(中間期)決算参考資料', year: '2025', q: 2 },
        { title: '2025年12月期第3四半期連結決算の概要', year: '2024', q: 3 },
        { title: '2023年度第2四半期決算', year: '2023', q: 2 },
        { title: '2026年3月期第2四半期決算Fact Sheet', year: '2025', q: 2 },
        { title: '2025年度(26年3月期)第2四半期決算概要', year: '2025', q: 2 },
        { title: '2026年3月期第2四半期決算説明会', year: '2025', q: 2 },
        // 上期パターン
        { title: '2026年3月期上期決算説明会資料', year: '2025', q: 2 },
        { title: '日産自動車、2025度上期決算を発表', year: '2025', q: 2 },
        // 決算短信
        { title: '2024年3月期第2四半期決算短信〔米国基準〕(連結)', year: '2023', q: 2 },
        { title: '2025年12月期第3四半期決算短信〔IFRS〕(連結)', year: '2024', q: 3 },
        { title: '2025年8月期決算短信〔IFRS会計基準〕(連結)', year: '2024', q: 4 },
        { title: '2026年3月期中間決算短信〔米国会計基準〕(連結)', year: '2025', q: 2 },
      ];

      it.each(additionalDocs)('$title → $year年Q$q', ({ title, year, q }) => {
        expect(isStrategicDocument(title)).toBe(true);
        expect(determineFiscalYear(title)).toBe(year);
        expect(determineFiscalQuarter(title)).toBe(q);
      });
    });
  });
});
