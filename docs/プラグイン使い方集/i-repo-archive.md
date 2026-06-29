# i-repo-archive 使い方

> 帳票をまとめて保管し、必要ならファイルサーバーやクラウドへ配信する（macOS・Windows・Linux 対応）

帳票（PDF / Excel と項目の入力値）を**まとめてローカルに保管**し、必要なら
**指定フォルダ・ファイルサーバー（ネットワーク共有）やクラウド（S3 / GCS / Azure）へ配信**する
プラグインです。アプリの配信フローでは、まずこの archive が
対象期間の帳票を取り出し、その結果を後続の送り先（SQLite / MongoDB / S3 など）へ渡します。

## できること

| サブコマンド | やること |
|---|---|
| `create` | 対象期間の帳票・添付・項目値を取り出し、ローカルにひとまとめで保管する |
| `push-s3` | 保管フォルダを Amazon S3 へアップロードする（要 aws CLI） |
| `push-gcs` | 保管フォルダを Google Cloud Storage へアップロードする（要 gcloud CLI） |
| `push-azure` | 保管フォルダを Azure Blob Storage へアップロードする（要 az CLI） |
| `push-local` | 保管フォルダを**指定フォルダ・ファイルサーバー（ネットワーク共有）**へコピーする（外部 CLI 不要） |

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
# ※ --to は「親プレフィックス」を指定する。保管フォルダ名（例 2026-06）が自動で末尾に付き、
#    アップロード先は s3://my-bucket/irepo/2026-06/... になる。
i-repo archive push-s3 ~/irepo-archives/2026-06 \
  --to s3://my-bucket/irepo \
  --cleanup

# Google Cloud Storage へアップロード
i-repo archive push-gcs ~/irepo-archives/2026-06 \
  --to gs://my-bucket/irepo

# Azure Blob Storage へアップロード（認証は環境変数 or --sas / --connection-string）
i-repo archive push-azure ~/irepo-archives/2026-06 \
  --to https://<account>.blob.core.windows.net/<container>/irepo

# 指定フォルダ・ファイルサーバー（ネットワーク共有）へコピー（外部 CLI 不要）
# --to はマウント済みの共有/フォルダのパス。保管フォルダ名が末尾に自動付与される。
i-repo archive push-local ~/irepo-archives/2026-06 \
  --to /Volumes/share/irepo        # 例: Windows は \\server\share\irepo、Linux は /mnt/share/irepo
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

### push-s3 / push-gcs / push-azure / push-local（保管フォルダの配信）

| パラメータ | 型 | 説明 |
|---|---|---|
| `--to` | string **(必須)** | 配信先の**親プレフィックス／親フォルダ**（保管フォルダ名が末尾に自動付与）。s3=`s3://bucket/prefix`、gcs=`gs://bucket/prefix`、azure=`https://<account>.blob.core.windows.net/<container>/prefix`、local=フォルダ/ネットワーク共有のパス（例 `/Volumes/share/irepo`、`\\server\share\irepo`、`D:\irepo`） |
| `--cleanup` | bool | 配信確認後にローカルの保管フォルダを削除 |
| `--gcp-credentials` | string | （push-gcs のみ）**サービスアカウント鍵 JSON の「パス」**（鍵そのものではない）。無人運用の推奨認証。指定すると `gcloud` がこの鍵で認証します（対話ログイン不要） |
| `--access-key-id` / `--secret-access-key` | string | （push-s3 のみ）IAM アクセスキー。`--secret-access-key` は**秘密**なので引数に載せず環境変数で渡します（GUI は自動でそうします） |
| `--profile` / `--region` | string | （push-s3 のみ）名前付きプロファイル／リージョン。プロファイルやインスタンスロールで認証する場合に使う |
| `--sas` / `--connection-string` | string | （push-azure のみ）認証。値は **az の引数には載せず**環境変数で渡します。CLI を手で打つ場合は、シェル履歴やプロセス一覧に残らないよう**環境変数での指定を推奨**。未指定時はサインイン認証 |

> S3 は `aws` CLI、GCS は `gcloud` CLI、Azure は `az` CLI が必要です。**push-local は外部 CLI 不要**（OS のファイルコピーで動きます。ネットワーク共有はあらかじめマウント／割り当てしておきます）。アプリの「プラグイン」タブで各 CLI の有無・認証を確認できます。

## 無人運用（スケジュール / Webhook）での認証 — 重要

配信を**スケジュールや着信 Webhook で自動実行**するときは、認証方式に注意が必要です。

**対話ログイン（`gcloud auth login` / `aws sso login` / `az login`）は無人実行に使えません。** これらは
一定時間で**失効**し、失効すると再ログインを求めますが、無人実行には画面が無いため
`cannot prompt during non-interactive execution` のようなエラーで**配信が失敗**します
（アプリはこの失効を検知して復旧手順を示します）。手動の「今すぐ実行」は通っても、夜間のスケジュールだけ
失敗する、という形で表面化します。

無人運用では、失効しない**サービス資格情報**を使ってください。クラウドごとの標準は次のとおりです。

| クラウド | 無人向けの資格情報 | アプリ（接続先テンプレート）での設定 |
|---|---|---|
| **GCS** | **サービスアカウント鍵（JSON）** | 「サービスアカウント鍵ファイルのパス」に鍵 JSON の置き場所を入れる（`--gcp-credentials`）。権限は **`roles/storage.objectAdmin`**（対象バケットのオブジェクト CRUD）が最小で確実。厳密に絞るなら **`roles/storage.objectViewer` ＋ `roles/storage.objectCreator`** の2つ（差分アップロードと検証で一覧・取得が要るため **viewer は必須**）。バケット作成権限は不要（バケットは事前作成）。UBLA は ON 推奨 |
| **S3** | **IAM アクセスキー**（または名前付きプロファイル／インスタンスロール） | 「アクセスキーID」と「シークレットアクセスキー」を入れる（`--access-key-id` / `--secret-access-key`）。シークレットは伏字で保存され、実行時は環境変数で安全に渡されます。プロファイル運用なら「プロファイル名」 |
| **Azure** | **接続文字列** または **SAS トークン** | 「接続文字列」または「SAS」を入れる（`--connection-string` / `--sas`）。SAS は有効期限に注意（期限切れは無人運用で失効と同じ症状） |

ポイント:

- **最小権限**で発行する。ただし「書き込みだけ」では足りません——差分アップロードと配信検証で**一覧・取得（read）も必要**です（GCS は上表のとおり viewer が必須。削除権限は不要）。
- **秘密は伏字で保存**され、配信時は**コマンド引数ではなく環境変数**で渡されます（プロセス一覧やログに平文で出ません）。
- **GCS の鍵は「パス」**を渡します（鍵 JSON 本体はアプリに貼り付けず、ファイルとして安全な場所に置く）。**絶対パス**で、かつ**無人実行のユーザー（スケジューラ）から読める**場所に置いてください（相対パスや読めない場所が定番のハマり）。
- **GCS にリージョン設定は不要**（`gs://` はグローバル。S3 と違い `AWS_REGION` 相当は設定しない）。新しめの `gcloud`（`gcloud storage` サブコマンドが要る）と、**事前作成済みのバケット**が前提です。
- うまくいくか不安なときは、まず**手動実行で成功**を確認 → その後**スケジュールでも**成功することを確認してください
  （対話ログインに依存していると、ここで初めて差が出ます）。

> CLI を手で打つ場合も同様です。S3 のシークレットや Azure の接続文字列は**環境変数**で渡し（`AWS_SECRET_ACCESS_KEY` /
> `AZURE_STORAGE_CONNECTION_STRING` など）、シェル履歴・プロセス一覧に平文を残さないでください。

### 共通

| パラメータ | 型 | 説明 |
|---|---|---|
| `--dry-run` | bool | 書き込まず確認だけ行う |

## トラブルシューティング

- **項目の入力値が出ない（一覧の値しか入っていない）** → 「項目の入力値も含める」がOFF。アプリならフローのトグルを確認する。
- **push-s3 / push-gcs が失敗する** → `aws` / `gcloud` CLI が無い／未認証。アプリの「プラグイン」タブで状態（依存・認証）を確認する。
- **手動実行は通るのにスケジュールだけ失敗する** → 対話ログイン（`gcloud auth login` / `aws sso login` / `az login`）が失効している可能性。無人運用は失効しないサービス資格情報を使う（上の「無人運用での認証」を参照：GCS=サービスアカウント鍵、S3=IAM アクセスキー、Azure=接続文字列/SAS）。
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
