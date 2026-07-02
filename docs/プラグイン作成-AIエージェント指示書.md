---
title: プラグイン作成 AIエージェント指示書
nav_order: 6
---

# プラグイン作成 — AI エージェント指示書

> **人間の使い方**: エージェント（Claude Code / Codex CLI など）に **このファイルを読ませ**、やりたいことを一言
> 伝えれば、プラグインを作れます。例:
> 「**このファイルの手順に従って、社内 PostgreSQL に配信するプラグインを作って**」
> 「**受け取った帳票をローカルの CSV に追記するプラグインを、この指示書どおりに作って**」
>
> **置き場所**: この内容は**そのまま可搬**です。プラグインを作る作業リポジトリ（正本
> `i-repo-community/i-repo`）の `AGENTS.md` か `CLAUDE.md` に貼っておくと、そのリポジトリで作業するエージェントが
> 自動的に読みます。都度エージェントに読ませても構いません。
>
> 人間向けの丁寧な解説（図・トラブルシュート付き）は **[プラグイン作成ガイド](プラグイン作成ガイド.md)** を参照。

---

## エージェントへ — あなたへの指示

あなたはこれから **i-Repo のプラグイン**を作ります。プラグインとは、i-Reporter の帳票データを外部ストアへ
**配信（write→verify）** し、必要なら **読み返す（query）**、**1 ファイルの Node 実行ファイル**（`i-repo-<name>`、
1 行目 `#!/usr/bin/env node`）です。`~/.i-repo/plugins/` に置くと `i-repo <name> ...` として呼ばれます。

**大原則**: 以下の規約と手順を**そのまま守れば**動くものが作れます。**API を推測で作らない**。迷ったら
「深掘り資料」の spec と実プラグインを読んで確認する。**最後に必ず自己テストを緑にしてから完了報告する**。

### 手順（この順で進める）

1. **要件を確認する**（ユーザーに短く質問）:
   - 配信先ストアは何か（DB / クラウド / ローカルファイル / API …）。
   - 接続に要る情報（接続 URL・パス・テーブル名・認証情報など）と、その受け取り方（フラグ名）。
   - **読み返し（query）は要るか**（付けると DC 画面・AI から読める。無くても配信は動く）。
   - 保存したい項目（最小なら `idempotencyKey` と `values`＋封筒まるごとで十分）。
2. **骨格から始める**: 下の「最小スケルトン」をコピーし、`i-repo-<name>` として保存。`name` は
   `^[A-Za-z0-9][A-Za-z0-9_-]*$`。
3. **配信（write / verify）を実装**:
   - stdin の NDJSON を最後まで読み、`stream-end` トレーラの `count` と受信件数を照合（不一致・トレーラ欠落は
     **切断＝失敗**：`verified:false` の write receipt を出して `exit 1`）。
   - 各レコードを **`idempotencyKey` で UPSERT**（冪等。再実行で重複しない）。キーが無い行は一意な代替キーを振る。
   - 書いたものを**読み返して照合** → 一致で **`verified:true` の verify receipt**。
4. **（任意）読み返し（query）を実装**: `lib/gemba-read.js` を使う。行を `emitRow` で出し、**最後に必ず
   `queryEnd`（＝query-end トレーラ。0 件でも出す）**。**読み取り専用を厳守**（1 バイトも書かない）。
5. **`--plugin-schema` を正確に書く**（DC 画面・AI がこれを丸ごと信じる）:
   - `dataset[].locator`（実行時フラグ→着地先の対応）と `dataset[].fields`（物理列↔正準名）を実態と一致させる。
   - `datetime` 型の field は `format` と `timezone` を必ず宣言。`canonical` は下の許可値のみ。
6. **自己テスト（緑になるまで直す）**:
   ```bash
   i-repo plugin verify <name>          # 契約適合の一発チェック（まずこれ）
   node scripts/check-adc.mjs --fast    # C1〜C11 の適合性（sqlite/parquet。外部サービス不要）
   ```
7. **完了報告**: 作ったファイルのパス、何をするプラグインか、テスト結果（緑）、実行例（下記「動かし方」）。

### 絶対規約（外すと「動いてるのに失敗/切断扱い」になる）

- **配信の成功 ＝ receipt の `verified:true` のみ**（`exit 0` は成功ではない）。receipt の**必須フィールド**:
  `schemaVersion` / `recordType`（`"receipt"`）/ `plugin` / `phase`（`write`|`verify`）/ `jobId` / `count` /
  `failedCount` / `verified`。`jobId` は実行を識別する一意値（`write`/`verify` で同じ値）。
- **読みの成功 ＝ stdout 末尾の `query-end` トレーラのみ**（無ければ切断＝不採用）。**0 件でも必ず出す**。
- **secret は argv でなく環境変数**（`params[].secret:true` で宣言。生 URL/パスワードを argv に載せない）。
- **破壊的フラグ・サブコマンドは `destructive:true`**（`--cleanup` 等）。エージェント面には露出させない。
- **時刻の 3 形式を字句比較しない**: 業務時刻 `YYYY/MM/DD HH:mm:ss`（JST）・取込 ISO8601（UTC）・
  watermark `YYYY-MM-DD HH:MM:SS`（ローカル）。**必ずパースしてから比較**（UTC↔JST は 9 時間差）。
- **stdout を exit で切らない**: pipe だと `process.exit()` を急ぐと末尾（query-end / receipt）が欠ける。
  drain を待つ / `process.exitCode` を使う。外部 CLI を `spawnSync` する時は `maxBuffer` を上げる（例 `64*1024*1024`）。
- **query は読み取り専用**（書き込み・スキーマ変更・ファイル作成の禁止。SQLite は read-only open）。
- **クロスプラットフォーム**（macOS/Windows/将来 Linux）: 外部 CLI 起動は `lib/spawn.js` の `spawnSyncSpec`、
  SQL 等は argv でなく stdin で渡す。

### 使う共有部品（自作しない）

- `lib/gemba-read.js` … `createReadKit(PLUGIN)` → `{ emitRow, queryEnd, queryError }`、
  `parseQueryArgs(qargs, connSpec, queryError)` → `opts`、`timeBounds` / `encodeCursor` / `pickFields`。
- `lib/spawn.js` … `spawnSyncSpec`（Windows の `.cmd` ラップ・危険メタ文字拒否を肩代わり）。

### `canonical`（正準名）に使える値（閉じた集合）

`idempotencyKey` / `recordType` / `itemId` / `revNo` / `name` / `deleted` / `registTime` / `updateTime` /
`loadedAt` / `raw`。

### 受け取る封筒（正準レコード・NDJSON の 1 行）

```json
{"schemaVersion":"1.0","recordType":"report","itemId":"01234","revNo":"2","deleted":false,
 "idempotencyKey":"report:01234:rev2",
 "values":{"name":"日次点検","registTime":"2026/06/11 08:30:00","updateTime":"2026/06/11 17:02:11"},
 "detail":{ /* シート/クラスター */ },"artifacts":[ /* PDF等 */ ]}
```
最小実装なら `idempotencyKey` と `values` を見て、封筒まるごと 1 列に保存すればよい（`detail`/`artifacts` は後で読み返せる）。

### 最小スケルトン（`query` 付き・これを起点に差し替える）

```js
#!/usr/bin/env node
"use strict";
const PLUGIN = "i-repo-mystore", VERSION = "0.1.0";
const argv = process.argv.slice(2);

if (argv[0] === "--plugin-schema") {
  process.stdout.write(JSON.stringify({
    pluginApi:["1"], schemaVersions:["1.0"], recordTypes:["*"], name:PLUGIN, version:VERSION,
    roles:["sink","read"], input:["stdin-ndjson"], platforms:["macos","linux","windows"],
    params:[{ name:"--db", type:"string", required:true }],   // 接続フラグ。secret は secret:true を付ける
    subcommands:[{ name:"query", mode:"read", input:["none"], output:["ndjson"] }],  // query を付けない場合は省く
    dataset:[{ datasetApi:["1"], contract:"gemba-adc/1.0", store:"mystore",
      locator:{ db:{ param:"--db" } },
      naming:"snake_case",
      keys:{ primary:"idempotency_key", upsert:true, dedupe:null },
      contents:"cumulative",
      fields:[
        { name:"idempotency_key", canonical:"idempotencyKey", source:"idempotencyKey", type:"string", role:"key" },
        // 例: { name:"loaded_at", canonical:"loadedAt", type:"datetime", format:"iso8601", timezone:"utc", role:"lineage" },
      ],
      quirks:[] }],
  }) + "\n");
  process.exit(0);
}
if (argv[0] === "--plugin-healthcheck") {
  // 依存（DBドライバ等）が使えるかを確認。使えなければ ok:false + hint。
  process.stdout.write(JSON.stringify({ ok:true, checks:[{ name:"ready", ok:true, severity:"required" }] }) + "\n");
  process.exit(0);
}
if (process.env.IREPO_PLUGIN_API && process.env.IREPO_PLUGIN_API !== "1") {
  console.error(`${PLUGIN}: unsupported IREPO_PLUGIN_API`); process.exit(11);
}
if (argv[0] === "query") {                                   // 読み返し（任意）。読み取り専用！
  const G = require("./lib/gemba-read.js");
  const { emitRow, queryEnd, queryError } = G.createReadKit(PLUGIN);
  const opts = G.parseQueryArgs(argv.slice(1), { "--db":"db" }, queryError);
  // ... 接続・SELECT・ページング ...  for (const r of rows) emitRow(r.key, r.loadedAt, r.record);
  queryEnd({ count:0, complete:true, nextCursor:null, dest:`mystore:${opts.db}`, dedupeApplied:false });  // ★0件でも
  process.exit(0);
}

const jobId = process.env.IREPO_JOB_ID || String(Date.now());   // 実行を識別する一意値（write/verify 共通）
const receipt = (phase,count,failed,verified) => process.stdout.write(JSON.stringify({
  schemaVersion:"1.0", recordType:"receipt", plugin:PLUGIN, jobId,
  producedBy:{ plugin:PLUGIN, version:VERSION }, phase, count, failedCount:failed, verified,
}) + "\n");

(async () => {                                               // 配信（write / verify）
  let text = ""; for await (const c of process.stdin) text += c;
  const lines = text.split("\n").map(s=>s.trim()).filter(Boolean);
  const records = []; let trailer = null, envelopes = 0;
  for (const line of lines) { let o; try { o = JSON.parse(line); } catch { records.push({_raw:line}); continue; }
    if (o && o.schemaVersion) envelopes++;
    if (o && o.recordType === "stream-end") { trailer = o; continue; } records.push(o); }
  if (trailer ? trailer.count !== records.length : envelopes > 0) {   // 切断＝失敗
    console.error("truncated/incomplete stream"); receipt("write", records.length, records.length, false); process.exit(1); }
  // --- write 相: for (const r of records) upsert(r.idempotencyKey, r); ---
  receipt("write", records.length, 0, false);
  // --- verify 相: 書いたキーを読み返して照合 ---
  receipt("verify", records.length, 0, true);                // ★ verified:true が唯一の成功信号
})().catch(e => { console.error(`${PLUGIN}: ${e.message}`); receipt("write",0,0,false); process.exit(1); });
```

### 動かし方（開発ループ）

```bash
# 開発中は node で直接（インストール不要・最速）
printf '%s\n' \
  '{"schemaVersion":"1.0","recordType":"report","itemId":"1","idempotencyKey":"r:1"}' \
  '{"schemaVersion":"1.0","recordType":"stream-end","count":1}' \
| node ./i-repo-<name> <接続フラグ>
# 最後の行に "phase":"verify","verified":true が出れば成功

# i-repo から呼べるようにする
cp ./i-repo-<name> ~/.i-repo/plugins/ && chmod +x ~/.i-repo/plugins/i-repo-<name>
i-repo plugin list && i-repo plugin verify <name>
```

### 深掘り資料（迷ったら読む・推測しない）

- 人間向け解説（図・トラブルシュート）: `docs/プラグイン作成ガイド.md`
- 契約の全文: `spec/gemba-adc/spec.md`（gemba-adc/1.0・gemba-read/1.0）
- 実プラグインの実装: `plugins/i-repo-sqlite`（write+verify+query の実例）・`plugins/i-repo-mongo`（`lib/spawn.js` 使用例）
- 共有部品: `plugins/lib/gemba-read.js` / `plugins/lib/spawn.js`
- 自己テスト: `scripts/check-adc.mjs` ほか
- ※ i-Repo GEMBA OS 側からは、いずれも `node_modules/i-repo/` 配下にあります。

### 完了条件（Definition of Done — これを満たしたら報告）

- [ ] `i-repo plugin list` に出る（命名・実行権・shebang・置き場所）。
- [ ] 配信: stream-end 照合 → write receipt → **verify receipt `verified:true`**。冪等 UPSERT。
- [ ] query を付けたなら: **0 件でも query-end**・読み取り専用。
- [ ] `--plugin-schema` の `dataset`/`fields`/`locator`/`datetime(format+timezone)` が実態と一致。`canonical` は許可値のみ。
- [ ] secret は env・破壊的は `destructive:true`・時刻は字句比較しない・exit で stdout を切らない。
- [ ] `i-repo plugin verify <name>` と `node scripts/check-adc.mjs --fast` が**緑**。
