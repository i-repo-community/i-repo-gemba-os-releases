# i-repo-sqlite 使い方

> Accumulate NDJSON records into a local SQLite database（UPSERT by idempotencyKey）
> （version 0.1.0 / phases: write, verify / input: stdin-ndjson / mac・Linux・Windows）

manifest の NDJSON を **ローカルSQLite に蓄積**する配信プラグイン。
サーバー不要・1ファイルで完結するため、**BIツール（Excel/Power BI/Metabase等）から直接読む**用途や、
ネットワークに出さずに手元で集計したいケースに向きます。Node.js 22.5+ の組み込み `node:sqlite` を使い、
追加の npm 依存はありません。

## テーブル構造

`idempotency_key` を主キーに UPSERT します（同じ帳票の再実行で重複しない）。

| カラム | 内容 |
|---|---|
| `idempotency_key` | 主キー（`report:<itemId>:rev<revNo>`） |
| `record_type` | レコード種別 |
| `item_id` | 帳票ID |
| `rev_no` | リビジョン番号 |
| `name` | 帳票名 |
| `deleted` | 削除フラグ |
| `regist_time` / `update_time` | 登録・更新日時 |
| `raw_json` | レコード全体のJSON（detail/artifacts含む） |
| `loaded_at` | 取込時刻 |

> クラスター値（`detail`）は `raw_json` の中に格納されます。SQLiteの
> [JSON関数](https://www.sqlite.org/json1.html)（`json_extract` 等）で取り出して検索・集計できます。

## Connector（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **sqlite** を選択
2. フォームに入力
   - **SQLite DBファイル**（必須）: `~/irepo-warehouse.db`（無ければ作成）
   - **テーブル名**（既定 `reports`）
3. 保存 → フローの配信先として選択（`--with-detail`をONにすると`raw_json`にクラスター値が入る）

## CLI での使い方

```bash
# manifest を SQLite に蓄積
cat .../manifests/reports.ndjson \
  | i-repo sqlite --db ~/irepo-warehouse.db --table reports

# 書き込まず検証だけ
cat .../reports.ndjson | i-repo sqlite --db ~/irepo-warehouse.db --dry-run
```

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|:--:|---|
| `--db` | string | ✓ | 出力先SQLiteファイル（無ければ作成） |
| `--table` | string | | テーブル名（既定: `reports`、無ければ作成） |
| `--dry-run` | bool | | 書き込まず検証のみ |

## SQL での検索例（クラスター値を JSON 関数で）

`raw_json` に `detail.clusters` が入っているので、JSON関数で展開して検索します。

```sql
-- 不具合内容クラスターの値に "Vv" を含む帳票（中間一致）
SELECT r.item_id, je.value
FROM reports r,
     json_each(json_extract(r.raw_json, '$.detail.clusters')) je
WHERE json_extract(je.value, '$.name')  = '不具合内容'
  AND json_extract(je.value, '$.value') LIKE '%Vv%';

-- 指摘区分ごとの件数（集計）
SELECT json_extract(je.value, '$.value') AS 指摘区分, COUNT(*) AS 件数
FROM reports r,
     json_each(json_extract(r.raw_json, '$.detail.clusters')) je
WHERE json_extract(je.value, '$.name') = '指摘区分'
GROUP BY 1 ORDER BY 件数 DESC;
```

## Mongo / SQLite の使い分け

| | SQLite | MongoDB |
|---|---|---|
| サーバー | 不要（1ファイル） | 必要 |
| BIツール連携 | ODBC/直読みが容易 | コネクタ要 |
| ネスト検索 | `json_each` で展開（やや冗長） | ネイティブにネスト検索 |
| 規模 | 〜数十万件・単一マシン | スケールアウト前提 |
| 向き | **手元集計・BI Ready** | **共有・大規模・全文検索** |

## トラブルシューティング

- **`node:sqlite` が無いエラー** → Node.js 22.5 以上が必要。`node --version` を確認。
- **クラスター値が `raw_json` に無い** → archive側の`--with-detail`が必要。
- **`verified:false`** → 書き戻し件数の不一致。stdinの途中切断やトレーラー欠落を確認。
