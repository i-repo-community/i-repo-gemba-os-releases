# i-repo-archive 使い方

> Stage report archives locally, then optionally push the bundle to S3
> （version 0.3.0 / phases: write, verify / mac・Linux・Windows）

帳票を**ローカルにスナップショット**し、必要なら**S3へ一括アップロード**するプラグイン。
Connector のすべてのフローの起点であり、ここで作られる `manifests/reports.ndjson` が
後段の配信プラグイン（mongo/sqlite/s3）への入力になります。

## サブコマンド

| サブコマンド | 入力 | 役割 |
|---|---|---|
| `create` | none | 帳票・添付・メタを抽出してローカルアーカイブを作る |
| `push-s3` | dir | `create` で作ったディレクトリをS3へアップロード（aws CLI必須） |

## 生成物（アーカイブの中身）

```
<out>/
├── documents/             … PDF/Excel等の実体ファイル
│   ├── 609___Vvb()-pdf.pdf
│   └── 609___Vvb()-excel.xlsx
├── manifests/
│   └── reports.ndjson     … 1行1帳票のメタデータ（後段への入力）
└── receipts/
    ├── archive.json       … archiveプラグインのreceipt
    └── connector-receipt.json
```

`reports.ndjson` の1レコード（`--with-detail` 時）:
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

## Connector（GUI）での使い方

archive はフローの**抽出設定**として組み込まれています（接続先テンプレートではなく、フロー自体の設定）。

1. フロー作成 → ①抽出設定
2. **対象期間**（昨日分／過去7日／期間指定）
3. **出力形式**: PDF＋メタ / PDF＋Excel＋メタ / **テキストのみ** / 一覧メタのみ
4. **「クラスター詳細を含める」をON** ← `--with-detail`。帳票の入力値（不具合内容・場所等）と
   添付の objectKey を manifest に埋め込む。**Mongo/SQLiteで検索したいなら必須**
   （※「テキストのみ」を選んだ場合は自動で ON 相当になります）

> ⚠️ `--with-detail` は帳票ごとに `reports get` を1回ずつ呼ぶため、帳票数が多いと抽出時間が伸びます。

### 出力形式（`--with-artifacts`）の使い分け

| 値 | バイナリDL | フィールド入力値(クラスター値) | 用途 |
|---|---|---|---|
| `pdf`（既定） | PDF | `--with-detail` 次第 | 帳票の見た目（PDF）も残す |
| `pdf,excel` | PDF＋Excel | `--with-detail` 次第 | Excel 出力も併せて残す |
| **`text`** | **なし** | **常に含める** | **解析・検索向け。PDF/Excel が不要な場面でテキストだけ軽量に取る** |
| `none` | なし | `--with-detail` 次第 | 一覧メタだけの最軽量（中身は取らない） |

`text` は「PDF/Excel のバイナリは無意味なので取らず、フィールドの入力値（テキスト）まで欲しい」とき向けです。
内部的には「バイナリ無し＋detail 強制 ON」と同義で、`--with-artifacts none --with-detail` を一発で指定できます。

## CLI での使い方

```bash
# 期間指定でローカルアーカイブを作成（クラスター詳細つき）
i-repo archive create \
  --out ~/irepo-archives/2026-06 \
  --with-artifacts pdf,excel \
  --with-detail \
  --regist-from "2026/06/01 00:00:00" \
  --regist-to   "2026/06/30 23:59:59"

# 作ったアーカイブをS3へpush（検証後にローカルを削除）
i-repo archive push-s3 ~/irepo-archives/2026-06 \
  --to s3://my-bucket/irepo/2026-06 \
  --cleanup
```

## 主なパラメータ

### create
| パラメータ | 型 | 説明 |
|---|---|---|
| `--out` | string | 出力先ディレクトリ（既定: `~/.i-repo/archives/<timestamp>`） |
| `--with-artifacts` | string | `pdf,pdfLayer,excel,text,none` をカンマ区切り（既定: pdf。`text`=バイナリ無し・フィールド値のみ） |
| `--with-detail` | bool | **クラスター値(detail)と添付objectKeyをmanifestに埋め込む** |
| `--definition-id` | string | 帳票定義IDで絞り込み |
| `--regist-from/to` | string | 登録日時の範囲（`YYYY/MM/DD HH:MM:SS`） |
| `--update-from/to` | string | 更新日時の範囲 |
| `--word` / `--word-target` | string | キーワード検索 |
| `--edit-status` / `--public-status` | string | 編集状態・公開状態で絞り込み |
| `--system-key` | string | システムキー `n=v`（繰り返し可） |
| `--force` | bool | 既存ディレクトリを再利用 |
| `--allow-worktree` | bool | gitワークツリー内への書き込みを許可 |
| `--endpoint`/`--user`/`--password` | string | 内側のi-repo呼び出しの接続先を上書き |

### push-s3
| パラメータ | 型 | 説明 |
|---|---|---|
| `--to` | string **(必須)** | アップロード先（`s3://bucket/prefix`） |
| `--cleanup` | bool | 検証成功後にローカルアーカイブを削除 |

### 共通
| パラメータ | 型 | 説明 |
|---|---|---|
| `--dry-run` | bool | 書き込まず検証のみ |

## トラブルシューティング

- **detailが空 / valuesしか出ない** → `--with-detail` が付いていない。Connectorならフローのトグルを確認。
- **push-s3が失敗** → `aws` CLIが見つからない/未認証。Connectorの「プラグイン」タブでhealthcheckを確認。
- **抽出が遅い** → `--with-detail` は帳票数×`reports get`。期間や定義で絞る。
