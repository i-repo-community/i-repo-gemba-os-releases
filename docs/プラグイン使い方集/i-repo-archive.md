# i-repo-archive 使い方

> 帳票をまとめて保管し、必要ならクラウドへアップロードする（macOS・Windows・Linux 対応）

帳票（PDF / Excel と項目の入力値）を**まとめてローカルに保管**し、必要なら
**クラウドへアップロード**するプラグインです。アプリの配信フローでは、まずこの archive が
対象期間の帳票を取り出し、その結果を後続の送り先（SQLite / MongoDB / S3 など）へ渡します。

## できること

| サブコマンド | やること |
|---|---|
| `create` | 対象期間の帳票・添付・項目値を取り出し、ローカルにひとまとめで保管する |
| `push-s3` | `create` で作った保管フォルダを Amazon S3 へアップロードする（要 aws CLI） |

## アプリ（GUI）での使い方

archive は**フローの「抽出設定」**として組み込まれています（送り先テンプレートではなく、フロー自体の設定です）。

1. フローを作成 → ①抽出設定 を開く
2. **対象期間**を選ぶ（昨日分 / 過去7日 / 期間指定）
3. **出力形式**を選ぶ（PDF＋一覧 / PDF＋Excel＋一覧 / テキストのみ / 一覧だけ）
4. **「項目の入力値も含める」をON**にする
   - 不具合内容・場所などの**入力値**を一緒に取り込みます。**MongoDB / SQLite で中身を検索したいなら必須**です
   - （「テキストのみ」を選んだときは自動で含まれます）

> ⚠️ 「項目の入力値も含める」は帳票を1件ずつ読みにいくため、件数が多いと取り出しに時間がかかります。期間や帳票定義で絞ると速くなります。

### 出力形式の使い分け

| 出力形式 | PDF/Excel の実体 | 項目の入力値 | こんなとき |
|---|---|---|---|
| PDF（既定） | PDF | 設定しだい | 帳票の見た目（PDF）も残したい |
| PDF＋Excel | PDF＋Excel | 設定しだい | Excel も併せて残したい |
| **テキストのみ** | **なし** | **常に含む** | **検索・分析が目的で、PDF/Excel は不要。軽く速く取りたい** |
| 一覧だけ | なし | 設定しだい | 件数や一覧だけ確認したい（中身は取らない） |

「テキストのみ」は、**PDF/Excel のファイルは取らず、項目の入力値（テキスト）だけ**を軽く取り込むモードです。

## CLI での使い方

```bash
# 期間を指定してローカルに保管（項目の入力値つき）
i-repo archive create \
  --out ~/irepo-archives/2026-06 \
  --with-artifacts pdf,excel \
  --with-detail \
  --regist-from "2026/06/01 00:00:00" \
  --regist-to   "2026/06/30 23:59:59"

# 保管フォルダを S3 へアップロード（アップロード確認後にローカルを削除）
i-repo archive push-s3 ~/irepo-archives/2026-06 \
  --to s3://my-bucket/irepo/2026-06 \
  --cleanup
```

## 主なパラメータ

### create

| パラメータ | 型 | 説明 |
|---|---|---|
| `--out` | string | 保管先フォルダ（既定: `~/.i-repo/archives/<日時>`） |
| `--with-artifacts` | string | `pdf,pdfLayer,excel,text,none` をカンマ区切り（既定: pdf。`text`＝実体ファイル無し・入力値のみ） |
| `--with-detail` | bool | 項目の入力値も一緒に取り込む |
| `--definition-id` | string | 帳票定義IDで絞り込み |
| `--regist-from/to` | string | 登録日時の範囲（`YYYY/MM/DD HH:MM:SS`） |
| `--update-from/to` | string | 更新日時の範囲 |
| `--word` / `--word-target` | string | キーワード検索 |
| `--edit-status` / `--public-status` | string | 編集状態・公開状態で絞り込み |
| `--system-key` | string | システムキー `n=v`（繰り返し可） |
| `--force` | bool | 既存フォルダを再利用 |
| `--allow-worktree` | bool | git ワークツリー内への書き込みを許可 |
| `--endpoint`/`--user`/`--password` | string | 取り込み元の i-Reporter 接続先を上書き |

### push-s3

| パラメータ | 型 | 説明 |
|---|---|---|
| `--to` | string **(必須)** | アップロード先（`s3://bucket/prefix`） |
| `--cleanup` | bool | アップロード確認後にローカルの保管フォルダを削除 |

### 共通

| パラメータ | 型 | 説明 |
|---|---|---|
| `--dry-run` | bool | 書き込まず確認だけ行う |

## トラブルシューティング

- **項目の入力値が出ない（一覧の値しか入っていない）** → 「項目の入力値も含める」がOFF。アプリならフローのトグルを確認する。
- **push-s3 が失敗する** → `aws` CLI が無い／未認証。アプリの「プラグイン」タブで状態（依存・認証）を確認する。
- **取り出しが遅い** → 「項目の入力値も含める」は件数に比例して時間がかかる。期間や帳票定義で絞る。

---

## 技術メモ（仕組み・後段プラグインへの入力）

> ここから先は中身の構造を知りたい人向けです。ふだんの利用では読まなくて問題ありません。

`create` は保管フォルダを次の構成で作ります。後段の送り先プラグイン（mongo / sqlite / s3 など）は、
この中の一覧ファイル（`manifests/reports.ndjson`）を入力として受け取ります。

```
<out>/
├── documents/             … PDF / Excel などの実体ファイル
│   ├── 609___Vvb()-pdf.pdf
│   └── 609___Vvb()-excel.xlsx
├── manifests/
│   └── reports.ndjson     … 1行1帳票の一覧データ（後段への入力）
└── receipts/
    ├── archive.json       … 実行の控え（取り込み件数など）
    └── connector-receipt.json
```

一覧ファイル（`reports.ndjson`）の1行は、「項目の入力値も含める」を ON にすると次の形になります
（`detail` に入力値、`artifacts` に実体ファイルの場所が入ります）:

```json
{
  "schemaVersion": "1.0", "recordType": "report",
  "itemId": "609", "revNo": "1", "isCurrent": true, "deleted": false,
  "idempotencyKey": "report:609:rev1",
  "systemKeys": {}, "attachments": [],
  "values": { "type": "...", "itemId": "609", "name": "...", ... },
  "artifacts": [
    { "type": "pdf",   "file": "609___Vvb()-pdf.pdf",   "objectKey": "documents/609___Vvb()-pdf.pdf" },
    { "type": "excel", "file": "609___Vvb()-excel.xlsx", "objectKey": "documents/609___Vvb()-excel.xlsx" }
  ],
  "detail": {
    "sheetCount": 2, "clusterCount": 48,
    "clusters": [
      { "name": "不具合内容", "value": "Vvb", "sheetNo": "1", "clusterId": "12" },
      { "name": "指摘区分",   "value": "法定指摘", "sheetNo": "1", "clusterId": "8" }
    ]
  }
}
```
