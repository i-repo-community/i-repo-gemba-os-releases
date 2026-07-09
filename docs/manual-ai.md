---
title: AI 連携の詳細
parent: ユーザーマニュアル
nav_order: 6
---

# AI 連携の詳細

配信が成功するたびに、AI が読むための索引（カタログ）が `~/.i-repo/catalog/` に書き出されます。

- **アプリの中で質問する**なら → [現場 AI チャット](screen-agent.html)（**Claude / Codex** を切り替えて使えます。Codex は試験的対応）。件数の内訳・合計・月別などの**集計**は、全行を取り出さず配信先（SQLite / Elasticsearch / MongoDB / Parquet / BigQuery）側で計算して答えるため、大量でも軽量です。
- **手元の Claude Code / Codex CLI から読ませる**なら → [エージェント接続](screen-mcp.html)（接続コマンドは画面が表示します）

いずれの場合も AI からの操作は**読み取り専用**で、書き込み・削除はできません。詳しい契約はエージェント・データアクセス仕様（`gemba-adc/1.2`）を参照してください。正本は i-repo CLI 同梱の `spec/gemba-adc/spec.md`（開発者・上級者向け）。

## プロバイダを選ぶ（サブスク / API / Bedrock / Vertex / Foundry）

現場 AI チャットの Claude は、**お使いの Claude Code CLI がどのプロバイダで使えるようになっているかをそのまま使います**。アプリ側で別途プロバイダを設定する必要はありません。

- **Claude サブスク（Pro / Max）**: 既定。`claude` で OAuth サインインして使います。
- **Anthropic API**: `ANTHROPIC_API_KEY` を設定して使います。
- **Amazon Bedrock**: `CLAUDE_CODE_USE_BEDROCK=1` と AWS 側の認証（`AWS_PROFILE` / `aws sso login` / `AWS_BEARER_TOKEN_BEDROCK`）で使います。
- **Google Vertex AI**: `CLAUDE_CODE_USE_VERTEX=1` と `gcloud auth application-default login`、`CLOUD_ML_REGION`・`ANTHROPIC_VERTEX_PROJECT_ID` の設定で使います。
- **Microsoft Foundry**: `CLAUDE_CODE_USE_FOUNDRY=1` と `ANTHROPIC_FOUNDRY_RESOURCE` / `ANTHROPIC_FOUNDRY_API_KEY`（または `az login`）で使います。セットアップウィザードはなく、環境変数のみで設定します。

Bedrock / Vertex / Foundry を使う場合、`claude` の認証はその**クラウド側**（AWS / GCP / Azure）で行われます。`claude auth login` ではありません。

おすすめの設定方法は、Claude Code 本体のログインウィザード（`claude` を起動 → 「サードパーティ プラットフォーム」→ Bedrock / Vertex を選択）です。Foundry のみ環境変数だけでの設定になります。
