# i-repo-sqlite 使い方

> 帳票データを手元の SQLite データベースにためて、Excel や BI ツールから読めるようにする（macOS・Windows・Linux 対応）

帳票（項目の入力値）を**手元の SQLite ファイル1つにためていく**送り先プラグインです。
サーバーを立てる必要がなく、ファイルが1つあれば完結するので、**Excel / Power BI / Metabase などの
BI ツールから直接読みたい**ときや、**ネットワークに出さずに手元で集計したい**ときに向きます。

同じ版（リビジョン）の帳票を何度送っても**重複しません**（最新で上書き）。帳票が改訂されると、新しい版として別途記録されます（古い版も残ります）。

## できること

- 帳票の入力値を、手元の SQLite ファイル（1ファイル）にためていく
- Excel / Power BI / Metabase などの BI ツールから直接読む
- SQL でしぼり込み・集計する（クラスター値も検索できる）

## アプリ（GUI）での使い方

1. 接続先テンプレート → 新規 → プラグイン **sqlite** を選択
2. フォームに入力
   - **SQLite DBファイル**（必須）: `~/irepo-warehouse.db`（無ければ作成）
   - **テーブル名**（既定 `reports`）
3. 保存 → フローの配信先として選択

> 💡 不具合内容・場所などの**項目の入力値**まで検索したいときは、抽出設定で「項目の入力値も含める」を ON にしてください（archive 側の設定）。OFF だと一覧の値だけが入ります。

## CLI での使い方

```bash
# 取り出した帳票を SQLite にためる
cat .../manifests/reports.ndjson \
  | i-repo sqlite --db ~/irepo-warehouse.db --table reports

# 書き込まず確認だけ
cat .../reports.ndjson | i-repo sqlite --db ~/irepo-warehouse.db --dry-run
```

## 主なパラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|:--:|---|
| `--db` | string | ✓ | 出力先 SQLite ファイル（無ければ作成） |
| `--table` | string | | テーブル名（既定: `reports`、無ければ作成） |
| `--dry-run` | bool | | 書き込まず確認のみ |

## トラブルシューティング

- **項目の入力値（クラスター値）が入っていない** → 抽出設定の「項目の入力値も含める」が OFF。アプリならフローのトグルを確認する。
- **`node:sqlite` が無いエラー** → Node.js 22.5 以上が必要。`node --version` で確認する。
- **送信済みの確認がとれない（失敗扱い）** → ためた件数が合っていない状態です。取り出しの途中で中断していないか確認する。

## SQLite と MongoDB の使い分け

| | SQLite | MongoDB |
|---|---|---|
| サーバー | 不要（1ファイル） | 必要 |
| BI ツール連携 | 直接読みやすい | 専用コネクタが必要 |
| 入れ子の検索 | SQL でひと手間かけて展開 | そのまま入れ子を検索 |
| 規模 | 手元・単一マシン向け | 共有・大規模向け |
| 向き | **手元集計・BI ですぐ使える** | **共有・大規模・全文検索** |

---

## 技術メモ（仕組み）

> ここから先は仕組みを知りたい人向けです。ふだんの利用では読まなくて問題ありません。

Node.js 22.5+ の組み込み `node:sqlite` を使い、追加の npm 依存はありません。

### テーブル構造

`idempotency_key`（＝ `report:<itemId>:rev<revNo>`）を主キーに UPSERT します。同じ版の再送は上書き（重複しない）、改訂版（別 `revNo`）は別の行として追加されます（`--history` で複数版を取り込むと各版が共存）。

| カラム | 内容 |
|---|---|
| `idempotency_key` | 主キー（`report:<itemId>:rev<revNo>`） |
| `record_type` | レコード種別 |
| `item_id` | 帳票ID |
| `rev_no` | リビジョン番号 |
| `name` | 帳票名 |
| `deleted` | 削除フラグ |
| `regist_time` / `update_time` | 登録・更新日時 |
| `raw_json` | レコード全体のJSON（detail/artifacts 含む） |
| `loaded_at` | 取込時刻 |

クラスター値（`detail`）は `raw_json` の中に格納されます。SQLite の
[JSON関数](https://www.sqlite.org/json1.html)（`json_extract` 等）で取り出して検索・集計できます。

### SQL での検索例（クラスター値を JSON 関数で）

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

### 成功の判定について

書き込み後、ためた件数が宣言どおりに揃ったときだけ「送信済みの確認」（receipt の `verified:true`）が立ちます。
途中で入力が切れている（トレーラ欠落など）と、この確認は立ちません。
