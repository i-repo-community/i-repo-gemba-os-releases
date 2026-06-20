# i-repo-parquet 使い方（Parquet / Apache Iceberg）

> 帳票データを分析向けの列フォーマットに変換し、データ基盤へ蓄積する（macOS・Windows・Linux 対応）

帳票（項目の入力値）を、分析エンジンがそのまま読める **Parquet ファイル**に変換、または
**Apache Iceberg テーブル**に蓄積する送り先プラグインです。

Parquet は DuckDB・Spark・Athena・BigQuery・Power BI などの分析エンジンがそのまま読める
標準的なフォーマットです。Iceberg はその上に**更新の安全性・スキーマの変更・過去時点の参照**を
足したテーブル形式で、複数のエンジンから同じテーブルを共有できます。

このプラグインは `duckdb` コマンドを利用します。`brew install duckdb` だけで動きます。

## 2つのモード

| モード | 指定 | 再実行したとき | 向いている用途 |
|---|---|---|---|
| **Parquet** | `--out file.parquet` | 同じファイルを上書きする | 手元での分析・BI・他システムへの受け渡し |
| **Iceberg** | `--iceberg-endpoint` ほか | 追記される（重複の扱いは後述） | 蓄積していくデータ基盤・複数エンジンでの共有 |

## 取り込まれる列

| 列 | 内容 |
|---|---|
| `idempotency_key` | 帳票を一意に識別するキー |
| `record_type` / `item_id` / `rev_no` / `name` / `deleted` | 帳票のメタ情報 |
| `regist_time` / `update_time` | 登録・更新日時 |
| `raw_json` | レコード全体のJSON（項目の入力値・添付の場所を含む） |
| `loaded_at` | 取り込んだ時刻 |

## Parquet モード（ローカル・最短30秒）

```bash
# 配信
cat <archive>/manifests/reports.ndjson \
  | i-repo parquet --out ~/warehouse/reports.parquet
# → 「送信済みの確認」が出れば成功

# duckdb でそのまま分析（入力値は raw_json から JSON 関数で取り出す）
duckdb -c "
SELECT item_id, je.value->>'name' AS クラスター, je.value->>'value' AS 値
FROM read_parquet('~/warehouse/reports.parquet') r,
     json_each(r.raw_json->'detail'->'clusters') je
WHERE je.value->>'value' LIKE '%Vv%';"
```

## Iceberg モード — Docker での試し方

MinIO（S3互換）＋ Iceberg REST カタログの compose を同梱しています：
[docker/iceberg/compose.yml](docker/iceberg/compose.yml)

```bash
# 1. スタック起動（MinIO :9000/:9001、REST カタログ :8181）
cd docs/プラグイン使い方集/docker/iceberg
docker compose up -d

# 2. カタログの起動確認
curl -s "http://localhost:8181/v1/config?warehouse=warehouse"

# 3. 帳票データを Iceberg テーブルへ追記
cat <archive>/manifests/reports.ndjson \
  | i-repo parquet \
      --iceberg-endpoint http://localhost:8181 \
      --warehouse warehouse \
      --iceberg-table irepo.reports \
      --s3-endpoint http://localhost:9000 \
      --s3-key-id admin --s3-secret password
# → 今回追記した分を読み戻して件数を照合し、確認できれば成功

# 4. duckdb から Iceberg テーブルとして読む
duckdb -c "
INSTALL iceberg; LOAD iceberg;
CREATE SECRET obj (TYPE s3, KEY_ID 'admin', SECRET 'password',
                   ENDPOINT 'localhost:9000', URL_STYLE 'path', USE_SSL false);
ATTACH 'warehouse' AS ic (TYPE iceberg, ENDPOINT 'http://localhost:8181',
                          AUTHORIZATION_TYPE 'none');
SELECT item_id, name, loaded_at FROM ic.irepo.reports;"

# 5. MinIO コンソールでデータファイルを覗く: http://localhost:9001 (admin/password)
#    → warehouse バケットに Parquet データ＋Iceberg メタデータが見える

# 後片付け（データも破棄）
docker compose down -v
```

## アプリ（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **parquet** を選択
2. **Parquetモード**: 「Parquet出力ファイル」だけ入力
   **Icebergモード**: RESTカタログURL・ウェアハウス名・テーブル（`irepo.reports`）と、
   MinIO等を使うなら S3エンドポイント・キーを入力
3. 保存 → フローの配信先として選択

## パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `--out` | string | Parquet出力ファイル（Parquetモード。再実行で上書き） |
| `--iceberg-endpoint` | string | Iceberg REST カタログURL（Icebergモード） |
| `--warehouse` | string | ATTACH するウェアハウス名 |
| `--iceberg-table` | string | `namespace.table`（無ければ作成） |
| `--s3-endpoint` | string | データファイル置き場（MinIO等。省略時はAWS S3） |
| `--s3-key-id` / `--s3-secret` | string(秘匿) | オブジェクトストアの認証 |
| `--s3-region` | string | リージョン（既定: us-east-1） |
| `--dry-run` | bool | 書き込まず検証のみ |

## どの置き場を選ぶか（送り先の使い分け）

| | sqlite | mongo | elastic | parquet/iceberg |
|---|---|---|---|---|
| 再実行で重複しない | ✓ | ✓ | ✓ | Parquet:上書き ✓ / Iceberg:追記 |
| 検索 | SQL+JSON関数 | ネスト検索・正本 | 全文・ファセット | 列指向スキャン・集計 |
| 共有 | 1ファイル | サーバー | サーバー | **オブジェクトストア（エンジン非依存）** |
| 向き | 手元BI | アプリ連携・正本 | 検索画面 | **DWH/Spark/Athena連携・長期蓄積** |

## トラブルシューティング

- **`duckdb` が見つからない** → `brew install duckdb`（アプリの「プラグイン」タブで状態を確認可能）。Iceberg 書き込みには **DuckDB 1.4 以上**が必要。
- **ATTACH で 401/404** → REST カタログ URL・ウェアハウス名を確認。同梱 compose は認証なし（`AUTHORIZATION_TYPE 'none'`）。
- **S3 アクセスエラー** → MinIO の場合 `--s3-endpoint http://…` 必須（path-style は自動設定）。`https://` を付ければ SSL 有効。
- **「送信済みの確認」が出ない** → 取り込んだ件数の照合に失敗しています。送り先（カタログ／ストア）の片方だけ落ちていないか確認する。

---

## 技術メモ（仕組み）

> ここから先は仕組みを知りたい人向けです。ふだんの利用では読まなくて問題ありません。

### 実装の流儀

実装は `duckdb` CLI を呼ぶ薄いアダプタです（mongo が mongosh を、s3 が aws を呼ぶのと同じ流儀）。
npm 依存はありません。

### 入力と出力

入力は前段 archive が作る一覧（データ）の NDJSON（`manifests/reports.ndjson`、1行1帳票）です。
配信が終わると receipt が2行（write → verify）出力され、`verified:true` が「送信済みの確認」にあたります。

### loaded_at と冪等性

`loaded_at`（取込時刻）はジョブごとに一意で、verify（取り込んだ件数の照合）と重複排除に使います。
Parquet モードは同ファイルを上書きするため冪等（再実行しても結果が増えません）。
Iceberg モードは追記（WRITE_APPEND）のため、再実行すると同じ帳票が増えます。

### Iceberg の重複排除（append の宿命）

Iceberg モードは追記なので、**同じフローを再実行すると同じ帳票が2行**になります
（DuckDB の Iceberg 書き込みは現状 INSERT のみで MERGE 不可）。読む側で最新だけ取ります：

```sql
-- idempotency_key ごとに最新 loaded_at の行だけ（latest-wins ビュー）
SELECT * FROM ic.irepo.reports
QUALIFY row_number() OVER (PARTITION BY idempotency_key ORDER BY loaded_at DESC) = 1;
```

運用では、このビューを定期的にマテリアライズ（compaction）するか、
冪等性が最優先なら Parquet モード（上書き）か sqlite/mongo（upsert）を選びます。
