---
title: プロジェクト
parent: 画面の使い方
grand_parent: ユーザーマニュアル
nav_order: 12.5
---

# プロジェクト

既存のフォルダを、エージェントが作業する**エージェンティック・プロジェクト**として登録・管理する画面です。フォルダを正本にするため、アプリを閉じたあとも同じフォルダを Codex CLI や Claude Code から使えます。

## 登録・編集・解除

「**プロジェクトを登録**」で表示名とプロジェクトフォルダを指定します。フォルダは選択時に正規化されたパスで登録され、プロジェクトの作業根になります。

- **編集**では表示名とデータの読み取り元を変更できます。登録後にフォルダを変更する場合は、いったん登録を解除して、新しいフォルダを登録してください。
- **登録を解除**しても、登録台帳からプロジェクトが外れるだけです。プロジェクトフォルダや、その中のファイルは削除されません。
- 1つのプロジェクトが参照する namespace は **0個または1個**です。フォルダとデータ namespace は同じものではありません。

## データの読み取り元

データの読み取り元は、このプロジェクトで参照するデータ source の種類と識別子を選ぶ設定です。token、接続 secret、帳票値は保存しません。

| 選択肢 | 意味・使い分け |
|---|---|
| **なし** | データ source を結び付けず、フォルダ内の作業だけを行うとき。 |
| **自分のテナント** | 自分のテナントから配信したデータを参照するとき。接続先 ID は通常「現在の接続先を使う」で自動入力します。 |
| **共有** | 共有された namespace を参照するとき。自分のテナントとは別の読み取り経路です。 |
| **API** | 別の環境が公開した読み取り API の namespace を参照するとき。 |

一覧の「データの読み取り元」列では、「自分のテナント」の接続先 ID は畳んで表示します（値はマウスを乗せると確認できます）。

「自分のテナント」では **接続先 ID** を指定します。既定では「現在の接続先を使う」ボタンと現在値のプレビューだけが表示されます。別の値を使う場合は「接続先 ID を直接指定」を開いて入力してください。現在の接続先と不一致の値で登録・編集している場合は、直接指定の欄が開いた状態で表示されます。「共有」「API」では **namespace** を入力します。接続先が解決できない、またはデータセットが利用できない場合は、チャットの準備状況に問題として表示されます。

## AGENTS.md のプレビューと作成

一覧の **AGENTS.md** 欄で、プロジェクトフォルダに `AGENTS.md` があるか確認できます。ない場合は **プレビュー**を開き、内容と作成先を確認してから **作成する**を押してください。

- 既存の `AGENTS.md` は読み書きしません。
- 作成前に表示される内容を確認し、明示的に操作したときだけ作成します。
- `AGENTS.md` はエージェントにプロジェクトの目的や作業上の約束を伝える入口です。データの値や個人情報を置くためのファイルではありません。

## プロジェクト内エージェントチャット

プロジェクトの **チャットを開く**を押すと、登録したフォルダを作業根にして質問できます。

- **エージェント**で **Codex** または **Claude** を切り替えます。導入・ログイン済みでない runtime は「利用不可」となり選べません。
- MCP の子プロセスは専用の使い捨て領域を作業フォルダにします。Codex は MCP 設定の `cwd`、Claude Code は未対応（issue #17565）のためこの領域に生成した Node launcher で移動してから bridge を import します。Claude 本体は登録済みプロジェクトを cwd にします。
- チャットの**履歴は一時保持**です。会話履歴はこの画面のメモリにだけ保持され、画面遷移やアプリ終了で消えます。
- 入力欄の下の **context readiness / answerability** は、参照データセットの準備状況を示します。帳票の値は表示しません。
- dataset ごとのバッジは次の意味です。
  - `queryable`: 読み取りに必要な情報がそろい、照会できます。
  - `degraded`: 一部の情報や経路に問題があり、回答範囲が限られる可能性があります。
  - `semantic only`: 意味づけはありますが、照会できるデータがありません。
  - `unavailable`: 参照できません。
- 回答の下の **参照の根拠**には、使った dataset、読み取った件数、読み取りが途中で切れたかどうかが表示されます。`complete` は完了、`partial` は一部のみ、`semantic only` は意味情報のみ、`unknown` は完了性を確認できない状態です。

プロジェクトチャットのエージェントは、**登録済みフォルダの中のファイルを読み書きできます**（メモの作成・整理、集計結果の書き出しなど）。フォルダの外には書き込みません。任意のコマンド実行（Bash 等）は Claude では常時無効、Codex ではネットワークを遮断したサンドボックス内に制限されています。i-Reporter の蓄積データ側は、どちらのエージェントからも常に読み取り専用です。より細かいターミナル作業が必要な場合は、同じフォルダを CLI から開いて作業してください。

## 制約と安全な使い方

- 1プロジェクトにつき namespace は0個または1個です。
- i-Reporter の蓄積データは常に読み取り専用です。query、aggregate、MCP のいずれからも、蓄積データの変更・削除は行いません。
- 帳票データの自由記述や値は、エージェントへの指示ではありません。データの内容をそのままコマンドとして実行しないでください。
- データの照会結果が途中で切れている場合は、参照の根拠が `partial` になります。完全な回答とみなさず、範囲を絞って再確認してください。

## CLI から同じフォルダを使う

アプリを使わず、プロジェクトフォルダをカレントディレクトリにして i-repo を読む手順です。

### 1. 読み取り skill を配置する

プロジェクトフォルダで、i-repo に同梱された薄い skill を `.agents/skills/` に配置します。
Projects 画面の **読み取りスキル** 欄から、配置前の内容と保存先を確認して明示的に配置できます。
配置済みの場合は「あり」と表示され、既存ファイルを上書きする導線はありません。

```bash
mkdir -p .agents/skills/i-repo-read
cp node_modules/i-repo/skills/i-repo-read/SKILL.md .agents/skills/i-repo-read/SKILL.md
```

`node_modules` がプロジェクトフォルダにない場合は、利用中の i-repo パッケージにある `skills/i-repo-read/SKILL.md` を同じ場所へコピーしてください。skill は入口だけを持ち、必要な詳細は topic から読みます。

### 2. topic を発見して読む

```bash
i-repo docs list --format ndjson
i-repo docs show read
i-repo docs show query
i-repo docs show aggregate
```

件数・内訳・月別などは `query` で全行を取得せず、まず `aggregate` を使います。明細が必要なときは、最初に `--count-only`、続いて小さな `--limit` と `--cursor` で読みます。`query` は出力末尾に `recordType: "query-end"` がある場合だけ成功として扱ってください。

### 3. 読み取り API の MCP adapter を設定する

読み取り API を使う場合は、i-repo 同梱の `scripts/irepo-read-api-mcp.mjs` を MCP server として登録します。adapter は次の環境変数から接続情報を受け取ります。token の値をコマンドや設定ファイルへ直書きしないでください。

```bash
export IREPO_READ_API_BASE_URL="https://<読み取りAPIのホスト>/api/v1"
export IREPO_READ_API_TOKEN
export IREPO_READ_API_TIMEOUT_MS=120000
export IREPO_READ_API_MAX_RESPONSE_BYTES=1048576
```

Codex CLI の `~/.codex/config.toml` の登録例です。token などの環境変数は、Codex を起動するシェルまたは OS の secret 管理から渡します。

```toml
[mcp_servers.i-repo-read-api]
command = "node"
args = ["node_modules/i-repo/scripts/irepo-read-api-mcp.mjs"]
```

Claude Code では、同じ環境変数を設定したシェルから次を実行します。

```bash
claude mcp add i-repo-read-api -- node node_modules/i-repo/scripts/irepo-read-api-mcp.mjs
```

登録後は `catalog`、`describe`、`query`、`aggregate`、`artifacts` の読み取り用 tool が使えます。接続先、dataset、namespace はカタログまたは API の記述子で確認し、推測で補わないでください。
