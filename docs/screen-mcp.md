---
title: エージェント接続（Claude Code / Codex CLI）
parent: 画面の使い方
grand_parent: ユーザーマニュアル
nav_order: 11
---

# エージェント接続（Claude Code / Codex CLI）

お手元の AI エージェント（**Claude Code** または **Codex CLI**）に、送信済みの現場データを
**読み取り専用で**読ませるための画面です。設定すると、ターミナルの AI から
「先月の指摘が多かった項目は？」のように、現場データを使って質問に答えられるようになります
（AI は索引＝カタログを起点に、送信済みデータを**必要な分だけ読み取り参照**します。書き換え・削除はできません）。料金は各 AI のご自身の
アカウント側に発生します（このアプリは課金しません）。

<figure class="screenshot">
  <img src="../assets/img/screen-mcp.png" alt="エージェント接続（MCP）画面">
</figure>

## つなぎ方（3ステップ）

**① AI エージェントを用意する**（どちらか一方）

```bash
# Claude Code（Anthropic）
npm install -g @anthropic-ai/claude-code

# Codex CLI（OpenAI）
npm install -g @openai/codex
```

> インストールの最新手順は各公式サイトを参照してください。すでに入っている場合はこの手順は不要です。

**② この「エージェント接続」画面を開く**

お使いの環境に合わせた**接続コマンド／設定がそのまま表示**されます（必要なパスは自動で埋まります）。

**③ 使うエージェントに登録する**（画面の「コピー」ボタンを使うと確実）

- **Claude Code**: 「Claude Code」欄の **コピー** を押し、表示されたコマンドをターミナルで実行します。
  ```bash
  claude mcp add i-repo-gemba-os -- node <画面に表示されるパス>/irepo-mcp.mjs
  ```
- **Codex CLI**: 「Codex CLI」欄の **コピー** を押し、`~/.codex/config.toml` に貼り付けます。
  ```toml
  [mcp_servers.i-repo-gemba-os]
  command = "node"
  args = ["<画面に表示されるパス>/irepo-mcp.mjs"]
  ```

> 上のコマンド／設定は**例**です。環境により認証用の `-e KEY=VALUE`（Claude）や `env = { … }`（Codex）が
> 付くことがあるため、**画面に表示されたものをそのままコピー**してください（`args` はスクリプトの
> フルパス＝末尾が `irepo-mcp.mjs` であることを確認）。

登録後、エージェント側で **`i-repo-gemba-os`** のツール（`gemba_catalog` / `gemba_describe` /
`<プラグイン>_query` など）が使えるようになります。あとは AI に現場データについて聞くだけです。

> アプリの中だけで完結させたいなら、エージェントの用意は不要です → [現場 AI チャット](screen-agent.html)。
