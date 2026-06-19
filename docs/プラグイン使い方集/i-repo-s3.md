# i-repo-s3 使い方

> Deliver NDJSON / files to Amazon S3（write→verify→receipt）
> （version 0.2.0 / phases: write, verify / input: stdin-ndjson, files / mac・Linux）

NDJSON レコードや実体ファイルを **Amazon S3 へ配信**するプラグイン。
i-Repo DataPipe の「実体ファイル側（PDF/Excel）のストレージ」を担います。
`aws` CLI を利用します。

> ⚠️ **対応OSは mac・Linux のみ**（platforms に windows 無し）。
> Windows で使う場合は archive の `push-s3` か WSL を検討。

## 入力（2系統）

| input | 用途 |
|---|---|
| `stdin-ndjson` | manifest の NDJSON を行単位でオブジェクトとして配置 |
| `files` | アーカイブの実体ファイル（PDF/Excel等）をアップロード |

## Connector（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **s3** を選択
2. フォームに入力（いずれかの形式で宛先を指定）
   - **S3 destination**: `s3://bucket/key`（`--bucket`/`--prefix`より優先）
   - もしくは **bucket** ＋ **prefix** を個別指定
3. 保存 → フローの配信先として選択

## CLI での使い方

```bash
# manifest を S3 に配置（フル宛先指定）
cat .../manifests/reports.ndjson | i-repo s3 --to s3://my-bucket/irepo/manifests

# bucket + prefix で指定
cat .../reports.ndjson | i-repo s3 --bucket my-bucket --prefix irepo/manifests

# 書き込まず検証だけ
cat .../reports.ndjson | i-repo s3 --to s3://my-bucket/irepo --dry-run
```

## パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `--to` | string | フル宛先 `s3://bucket/key`（`--bucket`/`--prefix`・環境変数 `IREPO_S3_BUCKET` より優先） |
| `--bucket` | string | バケット名（`--prefix`と併用、`--to`未指定時） |
| `--prefix` | string | バケット内のキー接頭辞 |
| `--dry-run` | bool | 書き込まず検証のみ |

## 認証

`aws` CLI の標準的な認証解決に従います（環境変数 / `~/.aws/credentials` / プロファイル / IAMロール）。
Connector の「プラグイン」タブの healthcheck で `aws` の有無・認証の充足を確認できます。

## archive の push-s3 との使い分け

| | s3 プラグイン | archive push-s3 |
|---|---|---|
| 入力 | stdin / files（任意のNDJSON・ファイル） | `create`で作ったアーカイブ**ディレクトリ全体** |
| 用途 | 配信パイプラインの一段として柔軟に | アーカイブ束をまるごと退避 |
| OS | mac/Linux | mac/Linux/Windows |
| cleanup | なし | `--cleanup`でローカル削除可 |

**実体PDFを束で退避したいだけ**なら archive push-s3 が手軽。
**NDJSONを加工しながら配信**したいなら s3 プラグイン。

## トラブルシューティング

- **`aws`が見つからない** → `brew install awscli`。healthcheckで確認。
- **AccessDenied** → IAMポリシーで対象バケットへの `s3:PutObject` / `s3:GetObject`（verify用）を確認。
- **Windowsで使えない** → 非対応。Connectorは「プラグイン」タブでOS非対応を警告表示する。
