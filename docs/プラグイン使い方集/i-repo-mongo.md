# i-repo-mongo 使い方

> 帳票データを MongoDB に貯めて、項目の入力値を自由に検索・集計する（macOS・Windows・Linux 対応）

帳票（項目の入力値）を **MongoDB に蓄積**する送り先プラグインです。帳票の入れ子構造
（不具合内容や指摘区分などのクラスター値）を**そのままの形で保持**するため、表形式に
作り直さなくても、クラスター値の検索や集計がそのまま行えます。アプリの配信フローでは、
前段の archive が取り出した帳票を受け取り、この mongo が MongoDB へ書き込みます。

同じ版（リビジョン）の帳票を何度配信しても**重複しません**（最新で上書き）。帳票が改訂されると、新しい版として別途記録されます（古い版も残ります）。

## アプリ（GUI）での使い方

mongo は**フローの「送り先」**として組み込みます。

1. 接続先テンプレート → 新規 → プラグイン **mongo** を選択
2. 自動生成されたフォームに入力する

   | 項目 | 必須 | 例・既定値 |
   |---|:--:|---|
   | MongoDB接続URI（秘匿） | ✓ | `mongodb://localhost:27017` |
   | データベース名 | ✓ | `irepo` |
   | コレクション名 | | 既定 `reports` |

3. 保存 → フロー作成時に配信先として選ぶ

> 💡 前段 archive の「項目の入力値も含める」をONにしておくと、入力値（クラスター値）まで
> MongoDB に入り、検索・集計できる範囲が広がります。

## CLI での使い方

送り先プラグインは、archive が取り出した帳票の一覧（データ）を受け取って書き込みます。

```bash
# 帳票の一覧を mongo に書き込む
cat ~/irepo-archives/2026-06/manifests/reports.ndjson \
  | i-repo mongo \
      --uri "mongodb://localhost:27017" \
      --db irepo \
      --collection reports

# 書き込まず確認だけ
cat .../reports.ndjson | i-repo mongo --uri ... --db irepo --dry-run
```

## パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|:--:|---|
| `--uri` | string(秘匿) | ✓ | 接続文字列（`mongodb://` または `mongodb+srv://`） |
| `--db` | string | ✓ | データベース名 |
| `--collection` | string | | コレクション名（既定: `reports`、初回書き込みで作成） |
| `--dry-run` | bool | | 書き込まず確認のみ |

## トラブルシューティング

- **入力値（detail）が入っていない** → 前段 archive の「項目の入力値も含める」がOFF。mongo は渡されたものをそのまま書き込みます（捨てません）。アプリならフローのトグルを確認する。
- **`mongosh` が見つからない（アプリ起動時）** → `brew install mongosh` で導入する。アプリはログインシェルの `PATH` を引き継ぎます。
- **送信済みの確認が取れない** → 書き込み件数が合っていない可能性があります。入力データが途中で切れていないか確認する。

---

## MongoDBならではの検索クエリ集

> ここから先は仕組みを知りたい人向けです。ふだんの利用では読まなくて問題ありません。

帳票の入力値は `detail.clusters` に `{name, value, sheetNo, clusterId}` の**配列**として
入っています。これをネストのまま検索します。

### ① 中間一致（部分一致）— `$elemMatch` + 正規表現

```js
// 「不具合内容」クラスターの値に "Vv" を含む帳票（中間一致・大小無視）
db.reports.find({
  "detail.clusters": { $elemMatch: { name: "不具合内容", value: /Vv/i } }
})
```

> **`$elemMatch` が肝**: 配列なので「同じ1要素の中で name と value が両方一致」を保証する。
> これがないと「nameがAの要素」と「valueがBの別要素」でも誤ヒットする。

### ② 横断中間一致 — クラスター名を問わず

```js
// どのクラスターでもいいので値に "通路" を含む帳票
db.reports.find({ "detail.clusters.value": /通路/ })
```

### ③ 複合AND — 複数クラスター条件

```js
// 指摘区分=法定指摘 かつ 現象=その他
db.reports.find({ $and: [
  { "detail.clusters": { $elemMatch: { name: "指摘区分", value: "法定指摘" } } },
  { "detail.clusters": { $elemMatch: { name: "現象",     value: "その他" } } }
]})
```

### ④ 集計 — 指摘区分ごとの件数（BIダッシュボード用ファセット）

```js
db.reports.aggregate([
  { $unwind: "$detail.clusters" },
  { $match:  { "detail.clusters.name": "指摘区分" } },
  { $group:  { _id: "$detail.clusters.value", 件数: { $sum: 1 } } },
  { $sort:   { 件数: -1 } }
])
```

### ⑤ NoSQL → S3 リンク

```js
db.reports.findOne({ _id: "report:609:rev1" }, { artifacts: 1 })
// → [{type:"pdf", objectKey:"documents/609___Vvb()-pdf.pdf"}, ...]
// 構造化データはMongo、実体PDFはS3。objectKeyで突合
```

### ⑥ 値が入っているクラスターだけ投影（`$filter`）

```js
db.reports.aggregate([
  { $match: { _id: "report:609:rev1" } },
  { $project: { _id: 0, 入力値: {
      $filter: { input: "$detail.clusters", as: "c",
        cond: { $and: [ { $ne: ["$$c.value", "Image"] }, { $ne: ["$$c.value", ""] } ] } }
  }}}
])
```

## 高速化（中間一致を速くする）

`/Vv/` のような**中間一致は通常インデックスが効かない**（前方一致 `/^Vv/` なら効く）。

```js
// テキストインデックス（語単位の全文検索）
db.reports.createIndex({ "detail.clusters.value": "text" })
db.reports.find({ $text: { $search: "通路 外構" } })

// name で絞ってから regex（スキャン対象を減らす）
db.reports.createIndex({ "detail.clusters.name": 1 })
```

## Elasticsearch との違い

MongoDB は更新・整合性に強く、データの正本（マスター）に向きます。Elasticsearch は
検索に特化しており、大規模・日本語あいまい全文検索が要件なら向いています。

| 観点 | MongoDB | Elasticsearch |
|---|---|---|
| 中間一致 | `$regex` で書けるがフルスキャン。件数が増えると遅い | 転置インデックスで速い |
| 日本語あいまい | ほぼ完全一致 or regex。表記ゆれは苦手 | 形態素解析・同義語・スコアリングが標準 |
| 更新/整合性 | upsert・原子的更新が得意（正本向き） | 準リアルタイム。検索の写し向き |
| 集計 | `aggregate` で実用的 | ファセットがさらに高速・柔軟 |
| 運用 | 1プロセスで軽い | クラスタ前提で重い |

数千件規模までなら Mongo で中間一致も集計も問題ありません。大規模・日本語あいまい全文検索が
要件なら Elasticsearch が向きます。**Mongo＝正本（更新・S3突合）／Elastic＝検索の写し** の
使い分けもできます。

---

## 技術メモ（仕組み）

> ここから先は仕組みを知りたい人向けです。ふだんの利用では読まなくて問題ありません。

mongo は受け取った帳票の一覧（NDJSON）を MongoDB へ upsert します。`_id` は冪等キー
（`idempotencyKey`、なければ `report:<itemId>:rev<revNo>`）。同じ版の再配信は上書き（重複しない）、
改訂版（別 `revNo`）は別ドキュメントとして追加されます。レコードを丸ごと
展開（`{ ...record, _id, _loadedAt }`）するので、archive の `--with-detail` で付いた `detail` /
`artifacts` もそのまま保持されます。

```json
{
  "_id": "report:609:rev1",
  "itemId": "609", "revNo": "1", "isCurrent": true,
  "values": { ... },
  "artifacts": [ { "type": "pdf", "objectKey": "documents/609___Vvb()-pdf.pdf" } ],
  "detail": { "clusters": [ { "name": "不具合内容", "value": "Vvb" }, ... ] },
  "_loadedAt": "2026-06-12T00:49:49.973Z"
}
```

配信の成功は receipt（実行の控え）の `verified:true`（送信済みの確認）で判定します。
これが取れないときは書き戻し件数が一致していないため、入力（stdin）が途中で切れていないか、
receipt の count を確認してください。
