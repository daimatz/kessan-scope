-- earnings_release に announcement_date カラムを追加
-- 成長可能性資料など fiscal_year/fiscal_quarter が null の場合でも時系列ソート可能にする

ALTER TABLE earnings_release ADD COLUMN announcement_date DATE;

-- 既存データに announcement_date を設定（リリースに紐づく最古の earnings.announcement_date を使用）
UPDATE earnings_release
SET announcement_date = (
  SELECT MIN(announcement_date)
  FROM earnings
  WHERE earnings.release_id = earnings_release.id
);

-- インデックス追加（ソート用）
CREATE INDEX IF NOT EXISTS idx_earnings_release_announcement_date ON earnings_release(announcement_date);
