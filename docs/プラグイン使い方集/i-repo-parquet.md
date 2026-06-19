# i-repo-parquet 使い方（Parquet / Apache Iceberg）

> Write NDJSON records to Parquet / Apache Iceberg（DuckDB経由・Lakehouse Ready）
> （version 0.1.0 / phases: write, verify / input: stdin-ndjson / mac・Linux・Windows）

manifest の NDJSON を**列指向の Parquet** に変換、または **Apache Iceberg テーブル**に追記する
配信プラグイン。i-Repo DataPipe の「Lakehouse Manager」にあたります。
Parquet は DuckDB・Spark・Athena・BigQuery・Power BI 等の分析エンジンがそのまま読める
事実上の標準フォーマット。Iceberg はその上に **ACID・スキーマ進化・タイムトラベル**を足した
テーブル形式で、複数エンジンから同じテーブルを安全に共有できます。

実装は **duckdb CLI を呼ぶ薄いアダプタ**（mongo が mongosh を、s3 が aws を呼ぶのと同じ流儀）。
npm 依存ゼロ、`brew install duckdb` だけで動きます。

## 2つのモード

| モード | 指定 | 冪等性 | 用途 |
|---|---|---|---|
| **Parquet** | `--out file.parquet` | 再実行で**同ファイルを上書き**（冪等） | 手元分析・BI・他システムへの受け渡し |
| **Iceberg** | `--iceberg-endpoint` + `--warehouse` + `--iceberg-table` | **追記（append）**。再実行は重複 → 後述のクエリで排除 | 蓄積型レイクハウス・複数エンジン共有 |

## 列スキーマ（i-repo-sqlite と同じ展開）

| 列 | 内容 |
|---|---|
| `idempotency_key` | 冪等キー（`report:<itemId>:rev<revNo>`） |
| `record_type` / `item_id` / `rev_no` / `name` / `deleted` | 帳票メタ |
| `regist_time` / `update_time` | 登録・更新日時 |
| `raw_json` | **レコード全体のJSON（detail.clusters / artifacts 含む）** |
| `loaded_at` | 取込時刻（ジョブ毎に一意 → verify と重複排除に使う） |

## Parquet モード（ローカル・最短30秒）

```bash
# 配信
cat <archive>/manifests/reports.ndjson \
  | i-repo parquet --out ~/warehouse/reports.parquet
# → receipt 2行（write → verify）。verified:true なら成功

# duckdb でそのまま分析（クラスター値は raw_json から JSON 関数で）
duckdb -c "
SELECT item_id, je.value->>'name' AS クラスター, je.value->>'value' AS 値
FROM read_parquet('~/warehouse/reports.parquet') r,
     json_each(r.raw_json->'detail'->'clusters') je
WHERE je.value->>'value' LIKE '%Vv%';"
```

## Iceberg モード — Docker での試し方（実機検証済み）

MinIO（S3互換）＋ Iceberg REST カタログの compose を同梱しています：
[docker/iceberg/compose.yml](docker/iceberg/compose.yml)

```bash
# 1. スタック起動（MinIO :9000/:9001、REST カタログ :8181）
cd docs/プラグイン使い方集/docker/iceberg
docker compose up -d

# 2. カタログの起動確認
curl -s "http://localhost:8181/v1/config?warehouse=warehouse"

# 3. manifest を Iceberg テーブルへ追記
cat <archive>/manifests/reports.ndjson \
  | i-repo parquet \
      --iceberg-endpoint http://localhost:8181 \
      --warehouse warehouse \
      --iceberg-table irepo.reports \
      --s3-endpoint http://localhost:9000 \
      --s3-key-id admin --s3-secret password
# → verified:true（loaded_at で今回分を読み戻して件数照合）

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

## Connector（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **parquet** を選択
2. **Parquetモード**: 「Parquet出力ファイル」だけ入力
   **Icebergモード**: RESTカタログURL・ウェアハウス名・テーブル（`irepo.reports`）と、
   MinIO等を使うなら S3エンドポイント・キーを入力
3. 保存 → フローの配信先として選択

## パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `--out` | string | Parquet出力ファイル（Parquetモード。再実行で上書き=冪等） |
| `--iceberg-endpoint` | string | Iceberg REST カタログURL（Icebergモード） |
| `--warehouse` | string | ATTACH するウェアハウス名 |
| `--iceberg-table` | string | `namespace.table`（無ければ作成） |
| `--s3-endpoint` | string | データファイル置き場（MinIO等。省略時はAWS S3） |
| `--s3-key-id` / `--s3-secret` | string(秘匿) | オブジェクトストアの認証 |
| `--s3-region` | string | リージョン（既定: us-east-1） |
| `--dry-run` | bool | 書き込まず検証のみ |

## Iceberg の重複排除（append の宿命）

Iceberg モードは追記なので、**同じフローを再実行すると同じ帳票が2行**になります
（DuckDB の Iceberg 書き込みは現状 INSERT のみで MERGE 不可）。読む側で最新だけ取ります：

```sql
-- idempotency_key ごとに最新 loaded_at の行だけ（latest-wins ビュー）
SELECT * FROM ic.irepo.reports
QUALIFY row_number() OVER (PARTITION BY idempotency_key ORDER BY loaded_at DESC) = 1;
```

運用では、このビューを定期的にマテリアライズ（compaction）するか、
冪等性が最優先なら Parquet モード（上書き）か sqlite/mongo（upsert）を選びます。

## どの置き場を選ぶか（sink 4兄弟の使い分け）

| | sqlite | mongo | elastic | parquet/iceberg |
|---|---|---|---|---|
| 冪等 | upsert ✓ | upsert ✓ | _id置換 ✓ | Parquet:上書き✓ / Iceberg:append |
| 検索 | SQL+JSON関数 | ネスト検索・正本 | 全文・ファセット | 列指向スキャン・集計 |
| 共有 | 1ファイル | サーバー | サーバー | **オブジェクトストア＝エンジン非依存** |
| 向き | 手元BI | アプリ連携・正本 | 検索画面 | **DWH/Spark/Athena連携・長期蓄積** |

## トラブルシューティング

- **`duckdb` が見つからない** → `brew install duckdb`（healthcheck で確認可能）。Iceberg 書き込みには **DuckDB 1.4 以上**が必要。
- **ATTACH で 401/404** → REST カタログ URL・ウェアハウス名を確認。同梱 compose は認証なし（`AUTHORIZATION_TYPE 'none'`）。
- **S3 アクセスエラー** → MinIO の場合 `--s3-endpoint http://…` 必須（path-style は自動設定）。`https://` を付ければ SSL 有効。
- **verified:false** → verify は `loaded_at = 今回値` の行数照合。カタログ/ストアの片方だけ落ちていないか確認。
