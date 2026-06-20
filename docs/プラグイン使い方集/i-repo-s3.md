# i-repo-s3 使い方

> 帳票の一覧データや実体ファイルを Amazon S3 へ送る（mac・Linux のみ対応）

帳票の一覧データ（テキスト）や実体ファイル（PDF / Excel など）を **Amazon S3 へ送る**プラグインです。
アプリの配信フローでは、実体ファイル側（PDF / Excel）のクラウド保管先として使えます。
アップロードには `aws` CLI を利用します。

> ⚠️ **対応OSは mac・Linux のみです（Windows 非対応）**。
> Windows で使う場合は archive の `push-s3`、または WSL の利用を検討してください。

## できること

| やること | 内容 |
|---|---|
| 一覧データを送る | 帳票の一覧データ（テキスト）を1件ずつオブジェクトとして S3 に配置する |
| 実体ファイルを送る | アーカイブの実体ファイル（PDF / Excel など）を S3 へアップロードする |

## アプリ（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **s3** を選択
2. フォームに入力（いずれかの形式で宛先を指定）
   - **S3 destination**: `s3://bucket/key`（`--bucket`/`--prefix` より優先）
   - もしくは **bucket** ＋ **prefix** を個別指定
3. 保存 → フローの配信先として選択

## CLI での使い方

```bash
# 一覧データを S3 に配置（フル宛先指定）
cat .../manifests/reports.ndjson | i-repo s3 --to s3://my-bucket/irepo/manifests

# bucket + prefix で指定
cat .../reports.ndjson | i-repo s3 --bucket my-bucket --prefix irepo/manifests

# 書き込まず検証だけ
cat .../reports.ndjson | i-repo s3 --to s3://my-bucket/irepo --dry-run
```

## 主なパラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `--to` | string | フル宛先 `s3://bucket/key`（`--bucket`/`--prefix`・環境変数 `IREPO_S3_BUCKET` より優先） |
| `--bucket` | string | バケット名（`--prefix` と併用、`--to` 未指定時） |
| `--prefix` | string | バケット内のキー接頭辞 |
| `--dry-run` | bool | 書き込まず検証のみ |

### 認証

`aws` CLI の標準的な認証解決に従います（環境変数 / `~/.aws/credentials` / プロファイル / IAMロール）。
アプリの「プラグイン」タブの healthcheck で `aws` の有無・認証の充足を確認できます。

## archive の push-s3 との使い分け

| | s3 プラグイン | archive push-s3 |
|---|---|---|
| 入力 | 任意の一覧データ・ファイル | `create` で作ったアーカイブ**ディレクトリ全体** |
| 用途 | 配信パイプラインの一段として柔軟に | アーカイブ束をまるごと退避 |
| OS | mac / Linux | mac / Linux / Windows |
| cleanup | なし | `--cleanup` でローカル削除可 |

**実体PDFを束で退避したいだけ**なら archive push-s3 が手軽です。
**一覧データを加工しながら配信**したいなら s3 プラグインを使います。

## トラブルシューティング

- **`aws` が見つからない** → `brew install awscli` でインストール。healthcheck で確認できます。
- **AccessDenied** → IAMポリシーで対象バケットへの `s3:PutObject` / `s3:GetObject`（確認用）が許可されているか確認します。
- **Windows で使えない** → 非対応です。アプリは「プラグイン」タブで OS 非対応を警告表示します。

---

## 技術メモ（仕組み）

> ここから先は仕組みを知りたい人向けです。ふだんの利用では読まなくて問題ありません。

このプラグインは2系統の入力（manifest の NDJSON / files）を受け取り、`write→verify→receipt`
の手順で S3 へ配信します。

| input | 用途 |
|---|---|
| `stdin-ndjson` | manifest の NDJSON を行単位でオブジェクトとして配置 |
| `files` | アーカイブの実体ファイル（PDF/Excel等）をアップロード |

- **manifest（一覧データ）**: 1行1帳票の NDJSON。各行が S3 のオブジェクトとして配置されます。
- **write→verify→receipt**: 書き込み（write）後に S3 上の存在を検証（verify）し、結果を receipt（実行の控え）に記録します。配信の成功は receipt の `verified:true`（送信済みの確認）で判定します。exit 0 は成功ではありません。
- **冪等性（idempotency）**: 同じ帳票・同じ宛先への再配信は `objectKey` をキーとして上書きされ、二重に増えません。
