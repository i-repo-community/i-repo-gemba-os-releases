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
