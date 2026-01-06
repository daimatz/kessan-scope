# Kessan Scope

日本企業の決算発表を自動でウォッチし、AIによる分析を提供するWebアプリケーション。

**URL**: https://kessan-scope.fyi

## 概要

ユーザーがウォッチリストに登録した企業の決算発表を TDnet から自動検知し、決算短信・決算説明資料を Claude (Anthropic) で分析。経営戦略の視点からハイライト・ローライトを抽出してメール通知する。決算内容についてAIとチャット形式で質疑応答も可能。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React + TypeScript + Vite |
| バックエンド | Cloudflare Workers (Hono) |
| データベース | Cloudflare D1 (SQLite) |
| ファイルストレージ | Cloudflare R2 (PDF保存) |
| 非同期処理 | Cloudflare Queues |
| 認証 | Google OAuth 2.0 / Email+Password |
| LLM | Claude API (Anthropic) |
| メール送信 | MailerSend |
| 決算データ取得 | TDnet (やのしん WEB-API) / IRBANK |

## 主要機能

### 1. ユーザー管理
- Google OAuth または メール+パスワードによるログイン/登録
- メールアドレス確認（24時間有効なトークン）

### 2. 銘柄ウォッチリスト
- 証券コード（4-5桁）による銘柄登録
- 銘柄ごとのカスタム分析プロンプト設定
  - 例：「海外売上比率の推移に注目」「M&A戦略について分析」
- 過去決算の自動インポート（IRBANK経由）

### 3. 決算自動検知・分析
- TDnet を定期ポーリング（Cron Trigger: 9:00 / 18:00 JST）
- 対応資料タイプ:
  - **決算短信** (earnings_summary)
  - **決算説明資料** (earnings_presentation)
  - **成長可能性資料** (growth_potential)
- Claude による以下の自動生成:
  - 決算概要（経営戦略視点）
  - ハイライト（業績・戦略の良かった点）
  - ローライト（懸念事項・課題）
  - 主要指標（売上・営業利益・純利益・前年比）
  - ユーザー定義の分析観点に基づく詳細分析

### 4. カスタム分析
- ウォッチリストにカスタムプロンプトを設定
- 同じ決算を異なる分析軸で再分析可能
- 分析履歴の保存・閲覧

### 5. チャット機能
- 決算資料に対してAIと質疑応答
- 過去の決算との比較質問にも対応
- ストリーミングレスポンス

### 6. 通知システム
- 新規決算分析完了時にメール通知
- インポート完了・再分析完了時にもメール通知

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cloudflare                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  Workers (API)   │  │     Queues       │  │      D1       │ │
│  │                  │  │                  │  │   (SQLite)    │ │
│  │ - Auth           │  │ - 過去決算       │  │               │ │
│  │ - REST API       │  │   インポート     │  │ - users       │ │
│  │ - Chat (SSE)     │  │ - カスタム分析   │  │ - watchlist   │ │
│  │ - Cron Jobs      │  │   再生成         │  │ - earnings    │ │
│  └────────┬─────────┘  └────────┬─────────┘  │ - chats       │ │
│           │                     │            └───────────────┘ │
│  ┌────────┴─────────────────────┴────────────────────────────┐ │
│  │                          R2                                │ │
│  │                    (PDF Storage)                           │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
            │
            ▼
    ┌───────────────┐     ┌───────────────┐
    │    React      │     │  External APIs │
    │  (Frontend)   │     │                │
    │               │     │ - TDnet        │
    │ - ダッシュボード│     │ - IRBANK       │
    │ - 銘柄詳細     │     │ - Claude       │
    │ - 決算詳細     │     │ - MailerSend   │
    │ - チャット     │     │ - Google OAuth │
    └───────────────┘     └───────────────┘
```

## データモデル

### 主要テーブル

```sql
-- ユーザー
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  email_verified INTEGER DEFAULT 0,
  verification_token TEXT,
  verification_expires_at DATETIME
);

-- ウォッチリスト
CREATE TABLE watchlist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  custom_prompt TEXT,  -- ユーザー定義の分析プロンプト
  UNIQUE(user_id, stock_code)
);

-- 決算発表セット（決算短信+説明資料をまとめて管理）
CREATE TABLE earnings_release (
  id TEXT PRIMARY KEY,
  release_type TEXT NOT NULL,  -- 'quarterly_earnings' | 'growth_potential'
  stock_code TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  fiscal_quarter INTEGER,      -- 1-4 (NULLは成長可能性資料)
  summary TEXT,                -- LLM分析結果（JSON）
  highlights TEXT,             -- ハイライト（JSON配列）
  lowlights TEXT               -- ローライト（JSON配列）
);

-- 決算資料（個別ドキュメント）
CREATE TABLE earnings (
  id TEXT PRIMARY KEY,
  release_id TEXT REFERENCES earnings_release(id),
  stock_code TEXT NOT NULL,
  document_type TEXT,          -- 'earnings_summary' | 'earnings_presentation' | 'growth_potential'
  document_title TEXT,
  r2_key TEXT,                 -- R2に保存されたPDFのキー
  announcement_date DATE NOT NULL
);

-- ユーザー別決算分析
CREATE TABLE user_earnings_analysis (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  release_id TEXT NOT NULL REFERENCES earnings_release(id),
  custom_analysis TEXT,        -- カスタムプロンプトによる分析結果
  prompt_used TEXT,            -- 使用したプロンプト
  notified_at DATETIME,
  UNIQUE(user_id, release_id)
);

-- カスタム分析履歴
CREATE TABLE custom_analysis_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  analysis TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- チャット履歴
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  release_id TEXT NOT NULL REFERENCES earnings_release(id),
  role TEXT NOT NULL,          -- 'user' | 'assistant'
  content TEXT NOT NULL
);

-- 銘柄マスタ
CREATE TABLE stock_master (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  market TEXT,
  sector TEXT
);
```

## API エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/auth/google` | Google OAuth開始 |
| GET | `/api/auth/callback` | OAuth コールバック |
| GET | `/api/auth/me` | 現在のユーザー情報 |
| POST | `/api/auth/login` | メール+パスワードログイン |
| POST | `/api/auth/register` | メール+パスワード登録 |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/watchlist` | ウォッチリスト取得 |
| POST | `/api/watchlist` | 銘柄追加 |
| DELETE | `/api/watchlist/:id` | 銘柄削除 |
| PATCH | `/api/watchlist/:id` | 銘柄設定更新（カスタムプロンプト等） |
| POST | `/api/watchlist/:id/import` | 過去決算インポート開始 |
| POST | `/api/watchlist/:id/regenerate` | カスタム分析再生成 |
| GET | `/api/earnings` | ダッシュボード用決算一覧 |
| GET | `/api/earnings/:id` | 決算詳細 |
| GET | `/api/earnings/:id/pdf/:docId` | PDF取得 |
| GET | `/api/stocks/search` | 銘柄検索 |
| GET | `/api/stocks/:code` | 銘柄別決算履歴 |
| GET | `/api/chat/:releaseId` | チャット履歴取得 |
| POST | `/api/chat/:releaseId` | チャット送信（SSE） |

## ディレクトリ構成

```
kessan-scope/
├── README.md
├── package.json
├── shared/                    # フロント・バックエンド共通の型定義
│   └── src/
│       └── index.ts           # Zodスキーマ・型定義
├── backend/
│   ├── wrangler.toml          # Cloudflare Workers設定
│   ├── package.json
│   ├── src/
│   │   ├── index.ts           # Workerエントリポイント
│   │   ├── constants.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── routes/
│   │   │   ├── auth.ts        # 認証（OAuth/Email）
│   │   │   ├── watchlist.ts   # ウォッチリスト管理
│   │   │   ├── earnings.ts    # 決算データAPI
│   │   │   ├── chat.ts        # チャットAPI（SSE）
│   │   │   ├── stocks.ts      # 銘柄検索・詳細
│   │   │   └── users.ts       # ユーザー設定
│   │   ├── services/
│   │   │   ├── tdnet.ts       # TDnet API クライアント
│   │   │   ├── irbank.ts      # IRBANK スクレイピング
│   │   │   ├── claude.ts      # Claude API クライアント
│   │   │   ├── mailersend.ts  # メール送信
│   │   │   ├── pdfStorage.ts  # R2 PDF管理
│   │   │   ├── stockUpdater.ts        # 銘柄リスト更新
│   │   │   ├── newReleasesChecker.ts  # TDnet新着チェック
│   │   │   ├── historicalImport.ts    # 過去決算インポート
│   │   │   ├── regenerateProcessor.ts # 再分析処理
│   │   │   ├── earningsAnalyzer.ts    # 決算分析
│   │   │   ├── documentClassifier.ts  # 資料タイプ分類
│   │   │   └── documentSources.ts     # 資料URL解決
│   │   └── db/
│   │       ├── queries.ts
│   │       ├── userQueries.ts
│   │       ├── watchlistQueries.ts
│   │       ├── earningsQueries.ts
│   │       ├── releaseQueries.ts
│   │       └── analysisQueries.ts
│   ├── migrations/            # D1マイグレーション
│   └── test/
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── App.css
│       ├── api.ts             # APIクライアント
│       ├── components/
│       │   └── Layout.tsx
│       └── pages/
│           ├── Dashboard.tsx      # ダッシュボード
│           ├── Watchlist.tsx      # ウォッチリスト管理
│           ├── StockDetail.tsx    # 銘柄詳細
│           ├── ReleaseDetail.tsx  # 決算詳細・チャット
│           └── Settings.tsx       # 設定
└── migrations/
```

## 環境設定

### 必要なAPIキー・認証情報

| サービス | 必要な設定 |
|----------|------------|
| Claude (Anthropic) | API Key |
| MailerSend | API Key + 送信元メールアドレス |
| Google OAuth | Client ID / Client Secret |

### wrangler.toml

wrangler.toml はローカル開発用と本番用の設定を含む。詳細は `backend/wrangler.toml` を参照。

```toml
# 共通設定
name = "kessan-scope"
main = "src/index.ts"

# ローカル開発用
[[d1_databases]]
binding = "DB"
database_id = "placeholder"  # ローカルは SQLite エミュレーション

# 本番環境
[env.production.vars]
FRONTEND_URL = "https://kessan-scope.fyi"
ENVIRONMENT = "production"

[[env.production.d1_databases]]
binding = "DB"
database_id = "xxx"  # wrangler d1 create で取得した ID
```

### Secrets

ローカル開発用は `.dev.vars` ファイルに記載：

```bash
# backend/.dev.vars
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-proj-xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
JWT_SECRET=local-secret
MAILGUN_API_KEY=xxx
MAILGUN_DOMAIN=mg.example.com
MAILGUN_FROM_EMAIL=noreply@example.com
```

本番用は `--env=production` で設定：

```bash
wrangler secret put ANTHROPIC_API_KEY --env=production
wrangler secret put GOOGLE_CLIENT_ID --env=production
# ...
```

## 開発

```bash
# 依存関係インストール
npm install

# ローカル DB マイグレーション
cd backend && npm run db:migrate:local && cd ..

# 開発サーバー起動（フロント+バックエンド）
npm run dev

# フロントエンドのみ
npm run dev:frontend

# バックエンドのみ
npm run dev:backend

# テスト
npm run test
```

## デプロイ

### 初回セットアップ

#### 1. Cloudflare リソース作成

```bash
cd backend
wrangler d1 create kessan-scope-db      # → database_id を wrangler.toml に設定
wrangler r2 bucket create kessan-scope-pdfs
wrangler queues create kessan-scope-import
```

#### 2. 本番 DB マイグレーション

```bash
wrangler d1 migrations apply kessan-scope-db --remote
```

#### 3. Secrets 設定

```bash
wrangler secret put ANTHROPIC_API_KEY --env=production
wrangler secret put MAILGUN_API_KEY --env=production
wrangler secret put MAILGUN_DOMAIN --env=production
wrangler secret put MAILGUN_FROM_EMAIL --env=production
wrangler secret put GOOGLE_CLIENT_ID --env=production
wrangler secret put GOOGLE_CLIENT_SECRET --env=production
wrangler secret put JWT_SECRET --env=production
```

#### 4. Google OAuth 設定

[Google Cloud Console](https://console.cloud.google.com/apis/credentials) で Authorized redirect URI に追加:
- `https://api.kessan-scope.fyi/api/auth/callback`

### 本番デプロイ

```bash
# バックエンド（Worker）
cd backend
npm run deploy:production

# フロントエンド（Pages）
cd frontend
npm run deploy:production
```

### 本番環境

| サービス | URL |
|----------|-----|
| フロントエンド | https://kessan-scope.fyi |
| API | https://api.kessan-scope.fyi |

## 参考リンク

- [TDnet 適時開示情報](https://www.jpx.co.jp/markets/statistics-equities/misc/04.html)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Claude API](https://docs.anthropic.com/)
- [MailerSend](https://www.mailersend.com/)
