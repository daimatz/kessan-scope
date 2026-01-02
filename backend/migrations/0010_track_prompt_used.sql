-- user_earnings_analysis にどのプロンプトで分析したかを記録
-- 同じプロンプトでの再分析をスキップするため

ALTER TABLE user_earnings_analysis ADD COLUMN custom_prompt_used TEXT;
