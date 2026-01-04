-- 分析時のPDF選択でファイルサイズを考慮するため、file_sizeカラムを追加
ALTER TABLE earnings ADD COLUMN file_size INTEGER;
