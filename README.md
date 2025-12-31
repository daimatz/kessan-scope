# Stock Watcher - 株式ウォッチャー

日本株の四半期決算を自動でウォッチし、LLMによる要約と分析を提供するアプリケーション。

## 概要

ユーザーが指定した銘柄の決算発表を自動検知し、決算短信・決算発表資料をLLMで分析。ハイライト・ローライトを抽出してメール通知する。ユーザーは決算内容についてLLMと対話形式で質疑応答が可能。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| ビルド | TypeScript (typescript-go / Microsoft Go実装) |
| フロントエンド | React |
| バックエンド | Cloudflare Workers |
| データベース | Cloudflare D1 (SQLite) |
| 非同期処理 | Cloudflare Workflows |
| 認証 | Google OAuth 2.0 |
| LLM | OpenAI API (モデル選択可能) |
| メール送信 | MailerSend |
| 決算データ取得 | EDINET API |

## 主要機能

### 1. ユーザー管理
- Google OAuth によるログイン/登録
- ユーザープロファイル管理
- OpenAIモデル設定（gpt-4o, gpt-4-turbo, gpt-3.5-turbo 等）

### 2. 銘柄ウォッチリスト
- 証券コード（4桁）による銘柄登録
- 銘柄ごとのカスタム分析プロンプト設定
- ウォッチリストの管理（追加/削除/編集）

### 3. 決算自動検知・分析
- EDINET APIを定期ポーリング（Cloudflare Workflows）
- 四半期決算短信（XBRL/PDF）の取得・解析
- LLMによる以下の自動生成:
  - 決算ハイライト（業績の良かった点）
  - 決算ローライト（懸念事項・課題）
  - ユーザー定義の分析観点に基づく考察

### 4. 通知システム
- 決算分析完了時にメール通知（MailerSend）
- メール内に詳細ページへのリンク

### 5. 決算詳細・履歴ページ
- 決算サマリーの閲覧
- 過去の決算履歴一覧
- LLMとの質疑応答（チャット形式）
- 質疑応答履歴の保存・閲覧

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cloudflare                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  Workers (API)   │  │    Workflows     │  │      D1       │ │
│  │                  │  │                  │  │   (SQLite)    │ │
│  │ - Auth           │  │ - EDINET監視     │  │               │ │
│  │ - REST API       │  │ - 決算取得       │  │ - users       │ │
│  │ - Chat API       │  │ - LLM分析        │  │ - watchlist   │ │
│  │                  │  │ - メール送信     │  │ - earnings    │ │
│  └────────┬─────────┘  └────────┬─────────┘  │ - chats       │ │
│           │                     │            └───────────────┘ │
└───────────┼─────────────────────┼──────────────────────────────┘
            │                     │
            ▼                     ▼
    ┌───────────────┐     ┌───────────────┐
    │    React      │     │  External APIs │
    │  (Frontend)   │     │                │
    │               │     │ - EDINET       │
    │ - ダッシュボード│     │ - OpenAI       │
    │ - 銘柄管理     │     │ - MailerSend   │
    │ - 決算詳細     │     │ - Google OAuth │
    │ - チャット     │     └───────────────┘
    └───────────────┘
```

## データモデル（D1）

```sql
-- ユーザー
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  openai_model TEXT DEFAULT 'gpt-4o',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ウォッチリスト
CREATE TABLE watchlist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  stock_code TEXT NOT NULL,  -- 証券コード（4桁）
  stock_name TEXT,           -- 銘柄名
  custom_prompt TEXT,        -- ユーザー定義の分析プロンプト
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, stock_code)
);

-- 決算データ
CREATE TABLE earnings (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,      -- 例: "2024"
  fiscal_quarter INTEGER NOT NULL, -- 1-4
  announcement_date DATE NOT NULL,
  edinet_doc_id TEXT,             -- EDINETドキュメントID
  raw_data TEXT,                  -- 取得した生データ（JSON）
  summary TEXT,                   -- LLM生成サマリー（JSON）
  highlights TEXT,                -- ハイライト（JSON配列）
  lowlights TEXT,                 -- ローライト（JSON配列）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(stock_code, fiscal_year, fiscal_quarter)
);

-- ユーザー別決算分析
CREATE TABLE user_earnings_analysis (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  earnings_id TEXT NOT NULL REFERENCES earnings(id),
  custom_analysis TEXT,           -- カスタムプロンプトによる分析結果
  notified_at DATETIME,           -- 通知送信日時
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, earnings_id)
);

-- チャット履歴
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  earnings_id TEXT NOT NULL REFERENCES earnings(id),
  role TEXT NOT NULL,             -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Cloudflare Workflows

### 1. EDINET監視ワークフロー
```
[Cron Trigger: 毎時] 
  → EDINET APIで新規開示をチェック
  → ウォッチリストと照合
  → マッチしたら「決算分析ワークフロー」を起動
```

### 2. 決算分析ワークフロー
```
[決算検知]
  → EDINET から書類取得（PDF）
  → PDFを画像化（各ページをPNG化）
  → OpenAI Vision API で内容解析・サマリー生成
  → 各ユーザーのカスタムプロンプトで追加分析
  → D1に保存
  → MailerSend で通知メール送信
```

## API エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| GET | /api/auth/google | Google OAuth開始 |
| GET | /api/auth/callback | OAuth コールバック |
| GET | /api/auth/me | 現在のユーザー情報 |
| POST | /api/auth/logout | ログアウト |
| GET | /api/watchlist | ウォッチリスト取得 |
| POST | /api/watchlist | 銘柄追加 |
| DELETE | /api/watchlist/:id | 銘柄削除 |
| PATCH | /api/watchlist/:id | 銘柄設定更新 |
| GET | /api/earnings | 決算一覧 |
| GET | /api/earnings/:id | 決算詳細 |
| GET | /api/stocks/:code/earnings | 銘柄別決算履歴 |
| GET | /api/earnings/:id/chat | チャット履歴取得 |
| POST | /api/earnings/:id/chat | チャット送信 |
| PATCH | /api/users/settings | ユーザー設定更新 |

## ディレクトリ構成

```
stock-watcher/
├── README.md
├── package.json
├── tsconfig.json
├── wrangler.toml              # Cloudflare Workers設定
├── src/
│   ├── index.ts               # Workerエントリポイント
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── watchlist.ts
│   │   ├── earnings.ts
│   │   └── chat.ts
│   ├── workflows/
│   │   ├── edinet-monitor.ts  # EDINET監視
│   │   └── earnings-analyze.ts # 決算分析
│   ├── services/
│   │   ├── edinet.ts          # EDINET API クライアント
│   │   ├── openai.ts          # OpenAI API クライアント (Vision APIでPDF解析も担当)
│   │   └── mailersend.ts      # メール送信
│   ├── db/
│   │   ├── schema.sql
│   │   └── queries.ts
│   └── types/
│       └── index.ts
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Watchlist.tsx
│   │   │   ├── EarningsDetail.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/
│   │   │   ├── Chat.tsx
│   │   │   ├── EarningsSummary.tsx
│   │   │   └── StockCard.tsx
│   │   └── hooks/
│   │       └── useApi.ts
│   └── public/
└── migrations/
    └── 0001_initial.sql
```

## 外部サービス設定

### 必要なAPIキー・認証情報

| サービス | 必要な設定 |
|----------|------------|
| EDINET | APIキー（金融庁に申請） |
| OpenAI | APIキー |
| MailerSend | APIキー + ドメイン設定 |
| Google OAuth | Client ID / Client Secret |

### Cloudflare 設定

```toml
# wrangler.toml
name = "stock-watcher"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "stock-watcher"
database_id = "xxx"

[vars]
FRONTEND_URL = "https://stock-watcher.pages.dev"

# Secrets (wrangler secret put で設定)
# EDINET_API_KEY
# OPENAI_API_KEY
# MAILERSEND_API_KEY
# GOOGLE_CLIENT_ID
# GOOGLE_CLIENT_SECRET
# JWT_SECRET
```

## 開発ロードマップ

### Phase 1: 基盤構築
- [ ] プロジェクトセットアップ（typescript-go ビルド環境）
- [ ] D1 スキーマ作成・マイグレーション
- [ ] Google OAuth 認証実装
- [ ] 基本的なAPI実装

### Phase 2: コア機能
- [ ] EDINET API連携
- [ ] 決算データ取得・解析
- [ ] OpenAI連携（サマリー生成）
- [ ] Cloudflare Workflows実装

### Phase 3: ユーザー機能
- [ ] React フロントエンド構築
- [ ] ウォッチリスト管理UI
- [ ] 決算詳細・履歴ページ
- [ ] チャット機能

### Phase 4: 通知・仕上げ
- [ ] MailerSend連携
- [ ] メールテンプレート作成
- [ ] エラーハンドリング強化
- [ ] パフォーマンス最適化

## 注意事項・検討事項

1. **EDINET API制限**: レート制限あり。適切な間隔でポーリングが必要
2. **PDF解析**: OpenAI Vision APIを使用。PDFを画像化して解析するためトークン消費が大きい点に注意
3. **LLMコスト**: トークン消費量の監視・ユーザーへの課金検討
4. **Workflowsの制限**: 実行時間・メモリ制限の確認
5. **typescript-go**: 現時点ではプレビュー段階。本番利用時は安定性を要確認

## 参考リンク

- [typescript-go (GitHub)](https://github.com/nicholaides/typescript-go)
- [EDINET API](https://disclosure.edinet-fsa.go.jp/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [MailerSend](https://www.mailersend.com/)
