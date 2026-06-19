# i-Repo プラグイン使い方集

i-Repo GEMBA OS が利用する i-repo CLI プラグインの使い方をまとめます。
各プラグインは **自己記述（`--plugin-schema`）** を持ち、Connector の GUI はそのスキーマから
入力フォームを自動生成します。このため「プラグインを追加・修正すれば GUI は改修不要で追従」します。

## プラグイン一覧

| プラグイン | 役割 | 入力(intake) | 対応OS | ドキュメント |
|---|---|---|---|---|
| **archive** | 帳票のスナップショット作成（PDF/Excel/メタ＋クラスター詳細）。S3への一括push | `create`:none / `push-s3`:dir | mac/Linux/Win | [i-repo-archive](i-repo-archive.md) |
| **mongo** | NDJSONをMongoDBへupsert（帳票IDキーでネスト構造を保持） | stdin-ndjson | mac/Linux/Win | [i-repo-mongo](i-repo-mongo.md) |
| **s3** | NDJSON/ファイルをS3へ配信 | stdin-ndjson / files | mac/Linux | [i-repo-s3](i-repo-s3.md) |
| **sqlite** | NDJSONをローカルSQLiteへ蓄積（BI Ready） | stdin-ndjson | mac/Linux/Win | [i-repo-sqlite](i-repo-sqlite.md) |
| **elastic** | NDJSONをElasticsearchへindex（全文検索・ファセットの写し） | stdin-ndjson | mac/Linux/Win | [i-repo-elastic](i-repo-elastic.md) |
| **parquet** | NDJSONをParquet / Apache Icebergへ（Lakehouse Ready） | stdin-ndjson | mac/Linux/Win | [i-repo-parquet](i-repo-parquet.md) |
| **hello** | 動作確認用サンプル（引数・環境変数の確認） | — | 全OS | [i-repo-hello](i-repo-hello.md) |

## 役割分担（i-Repo DataPipe 構想）

```
                 ┌─────────────────────────────────────────┐
                 │  i-Repo GEMBA OS（このアプリ）      │
                 │  抽出範囲・配信先・スケジュールを管理       │
                 └───────────────┬─────────────────────────┘
                                 │ i-repo CLI を spawn
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                         ▼
   ┌─────────┐            ┌──────────────────┐      ┌──────────────┐
   │ archive │  manifest  │    配信プラグイン    │      │   配信プラグイン │
   │ create  │──NDJSON──▶ │  mongo / sqlite   │      │      s3       │
   └─────────┘            │ elastic / parquet │      │（実体PDF/Excel）│
                          │ （構造化データ）     │      └──────────────┘
                          └──────────────────┘       objectKey で突合
                       正本 / BI / 検索 / Lakehouse
```

- **構造化データ**（クラスター値・メタ）は Mongo（正本）/ SQLite（BI）/ Elastic（検索）/ Parquet・Iceberg（Lakehouse）に
- **実体ファイル**（PDF/Excel）は S3 に
- 両者は `artifacts[].objectKey` でリンク（`--with-detail` 時に付与）
- 冪等キー `report:<itemId>:rev<revNo>` が全sink共通 → どのストア間でも突合できる

## 配信の安全設計（全プラグイン共通）

すべての配信プラグインは **write → verify → receipt** の3段で動きます。

1. **write**: 書き込み（upsert / upload）
2. **verify**: 読み戻して件数・内容を照合
3. **receipt**: `verified:true/false` を含む受領書を出力

Connector は **`verified:true` のときだけ「外部書き出し済み」フラグ**を付けます。
`--dry-run` は検証のみで書き込まず、書き出し済みにもしません（クリーンアップ事故の防止）。

## 共通の前提

- i-Reporter の認証（エンドポイント/ID/PW）は **i-repo CLI設定**（`~/.i-repo/i-repo.json`）を共有します。
  Connector の「設定」画面から編集できます。
- プラグインは `~/.i-repo/plugins/` に置かれた実行ファイルです。
- Connector の「プラグイン」タブで、各プラグインの healthcheck（依存・認証の充足）と
  契約適合（verify）を確認できます。
